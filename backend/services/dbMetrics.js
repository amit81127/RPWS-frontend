// backend/services/dbMetrics.js
// Enterprise-grade MongoDB connection pool, query latency, active operations, and resource utilization telemetry

const { monitorEventLoopDelay } = require("perf_hooks");

class DbMetrics {
  constructor() {
    this.pool = {
      activeConnections: 0,
      checkedOutConnections: 0,
      totalCreated: 0,
      totalClosed: 0,
      waitQueueSize: 0,
      totalCheckouts: 0,
      failedCheckouts: 0,
      totalCheckoutWaitMs: 0,
      avgPoolWaitMs: 0,
      maxPoolWaitMs: 0,
      recentWaitSamples: [],
    };

    this.operations = {
      activeOperations: 0,
      peakActiveOperations: 0,
      totalStarted: 0,
    };

    this.commands = {
      totalCommands: 0,
      failedCommands: 0,
      totalDurationMs: 0,
      avgLatencyMs: 0,
      lastCommandDurationMs: 0,
      recentSamples: [],
      byCommand: {},
    };

    // Track checkout start times by client/connection checkout token
    this.inFlightCheckouts = [];
    this.isInstrumented = false;

    // Event loop delay histogram (10ms resolution)
    try {
      this.eventLoopHistogram = monitorEventLoopDelay({ resolution: 10 });
      this.eventLoopHistogram.enable();
    } catch (_) {
      this.eventLoopHistogram = null;
    }
  }

  calculatePercentile(samples, percentile) {
    if (!samples || samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(
      Math.floor((percentile / 100) * sorted.length),
      sorted.length - 1
    );
    return Number(sorted[index].toFixed(2));
  }

  instrument(mongooseConnection) {
    if (this.isInstrumented) return;
    this.isInstrumented = true;

    const setupClientListeners = () => {
      try {
        const client = mongooseConnection.getClient
          ? mongooseConnection.getClient()
          : mongooseConnection.client;
        if (!client) return;

        // 1. Connection Pool Events (CMAP)
        client.on("connectionCreated", () => {
          this.pool.totalCreated++;
          this.pool.activeConnections++;
        });

        client.on("connectionClosed", () => {
          this.pool.totalClosed++;
          this.pool.activeConnections = Math.max(0, this.pool.activeConnections - 1);
        });

        client.on("connectionCheckOutStarted", () => {
          this.pool.waitQueueSize++;
          this.inFlightCheckouts.push(Date.now());
          if (this.inFlightCheckouts.length > 500) {
            this.inFlightCheckouts.shift();
          }
        });

        client.on("connectionCheckedOut", () => {
          this.pool.waitQueueSize = Math.max(0, this.pool.waitQueueSize - 1);
          this.pool.checkedOutConnections++;
          this.pool.totalCheckouts++;

          const startTime = this.inFlightCheckouts.shift();
          if (startTime) {
            const waitMs = Math.max(0, Date.now() - startTime);
            this.pool.totalCheckoutWaitMs += waitMs;
            this.pool.avgPoolWaitMs = Number(
              (this.pool.totalCheckoutWaitMs / this.pool.totalCheckouts).toFixed(2)
            );
            if (waitMs > this.pool.maxPoolWaitMs) {
              this.pool.maxPoolWaitMs = waitMs;
            }
            if (this.pool.recentWaitSamples.length >= 100) {
              this.pool.recentWaitSamples.shift();
            }
            this.pool.recentWaitSamples.push(waitMs);
          }
        });

        client.on("connectionCheckOutFailed", () => {
          this.pool.waitQueueSize = Math.max(0, this.pool.waitQueueSize - 1);
          this.pool.failedCheckouts++;
          this.inFlightCheckouts.shift();
        });

        client.on("connectionCheckedIn", () => {
          this.pool.checkedOutConnections = Math.max(0, this.pool.checkedOutConnections - 1);
        });

        // 2. Command Lifecycle & Latency Monitoring
        client.on("commandStarted", (event) => {
          this.operations.totalStarted++;
          this.operations.activeOperations++;
          if (this.operations.activeOperations > this.operations.peakActiveOperations) {
            this.operations.peakActiveOperations = this.operations.activeOperations;
          }

          const cmd = event.commandName || "other";
          if (!this.commands.byCommand[cmd]) {
            this.commands.byCommand[cmd] = { count: 0, totalMs: 0, avgMs: 0 };
          }
          this.commands.byCommand[cmd].count++;
        });

        client.on("commandSucceeded", (event) => {
          this.operations.activeOperations = Math.max(0, this.operations.activeOperations - 1);
          const duration = event.duration || 0;
          this.commands.totalCommands++;
          this.commands.totalDurationMs += duration;
          this.commands.lastCommandDurationMs = Number(duration.toFixed(2));
          this.commands.avgLatencyMs = Number(
            (this.commands.totalDurationMs / this.commands.totalCommands).toFixed(2)
          );

          const cmd = event.commandName || "other";
          if (this.commands.byCommand[cmd]) {
            this.commands.byCommand[cmd].totalMs += duration;
            this.commands.byCommand[cmd].avgMs = Number(
              (this.commands.byCommand[cmd].totalMs / this.commands.byCommand[cmd].count).toFixed(2)
            );
          }

          if (this.commands.recentSamples.length >= 100) {
            this.commands.recentSamples.shift();
          }
          this.commands.recentSamples.push(this.commands.lastCommandDurationMs);
        });

        client.on("commandFailed", (event) => {
          this.operations.activeOperations = Math.max(0, this.operations.activeOperations - 1);
          this.commands.failedCommands++;
          this.commands.lastCommandDurationMs = Number((event.duration || 0).toFixed(2));
        });
      } catch (err) {
        console.warn("DbMetrics: Unable to attach client listeners:", err.message);
      }
    };

    if (mongooseConnection.readyState === 1) {
      setupClientListeners();
    } else {
      mongooseConnection.once("connected", setupClientListeners);
    }
  }

  getMetrics(maxPoolSize = 25) {
    const mem = process.memoryUsage();
    const p50Duration = this.calculatePercentile(this.commands.recentSamples, 50);
    const p95Duration = this.calculatePercentile(this.commands.recentSamples, 95);
    const p99Duration = this.calculatePercentile(this.commands.recentSamples, 99);

    const p50Wait = this.calculatePercentile(this.pool.recentWaitSamples, 50);
    const p95Wait = this.calculatePercentile(this.pool.recentWaitSamples, 95);

    const eventLoopLagMs =
      this.eventLoopHistogram && typeof this.eventLoopHistogram.mean === "number"
        ? Number((this.eventLoopHistogram.mean / 1e6).toFixed(2))
        : 0;

    const poolUtilizationPercent =
      maxPoolSize > 0
        ? Number(((this.pool.checkedOutConnections / maxPoolSize) * 100).toFixed(1))
        : 0;

    return {
      pool: {
        activeConnections: this.pool.activeConnections,
        checkedOutConnections: this.pool.checkedOutConnections,
        availableConnections: Math.max(0, maxPoolSize - this.pool.checkedOutConnections),
        waitQueueSize: this.pool.waitQueueSize,
        maxPoolSize,
        poolUtilizationPercent,
        totalCreated: this.pool.totalCreated,
        totalClosed: this.pool.totalClosed,
        totalCheckouts: this.pool.totalCheckouts,
        failedCheckouts: this.pool.failedCheckouts,
        avgPoolWaitMs: this.pool.avgPoolWaitMs,
        maxPoolWaitMs: this.pool.maxPoolWaitMs,
        p50PoolWaitMs: p50Wait,
        p95PoolWaitMs: p95Wait,
      },
      operations: {
        activeOperations: this.operations.activeOperations,
        peakActiveOperations: this.operations.peakActiveOperations,
        totalStarted: this.operations.totalStarted,
      },
      latency: {
        totalCommands: this.commands.totalCommands,
        failedCommands: this.commands.failedCommands,
        avgLatencyMs: this.commands.avgLatencyMs,
        lastCommandDurationMs: this.commands.lastCommandDurationMs,
        p50LatencyMs: p50Duration,
        p95LatencyMs: p95Duration,
        p99LatencyMs: p99Duration,
        byCommand: this.commands.byCommand,
      },
      resources: {
        memory: {
          rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
          heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
          heapTotalMb: Number((mem.heapTotal / 1024 / 1024).toFixed(1)),
          externalMb: Number((mem.external / 1024 / 1024).toFixed(1)),
        },
        eventLoopLagMs,
      },
    };
  }

  reset() {
    this.pool.waitQueueSize = 0;
    this.pool.checkedOutConnections = 0;
    this.operations.activeOperations = 0;
    this.inFlightCheckouts = [];
  }
}

const dbMetrics = new DbMetrics();

module.exports = dbMetrics;
