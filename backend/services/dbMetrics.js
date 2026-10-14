// backend/services/dbMetrics.js
// Connection pool and database query latency telemetry instrumentation

class DbMetrics {
  constructor() {
    this.pool = {
      activeConnections: 0,
      checkedOutConnections: 0,
      totalCreated: 0,
      waitQueueSize: 0,
    };

    this.commands = {
      totalCommands: 0,
      failedCommands: 0,
      totalDurationMs: 0,
      avgLatencyMs: 0,
      lastCommandDurationMs: 0,
      recentSamples: [],
    };

    this.isInstrumented = false;
  }

  instrument(mongooseConnection) {
    if (this.isInstrumented) return;
    this.isInstrumented = true;

    const setupClientListeners = () => {
      try {
        const client = mongooseConnection.getClient ? mongooseConnection.getClient() : mongooseConnection.client;
        if (!client) return;

        // Pool event monitoring
        client.on("connectionCreated", () => {
          this.pool.totalCreated++;
          this.pool.activeConnections++;
        });

        client.on("connectionClosed", () => {
          this.pool.activeConnections = Math.max(0, this.pool.activeConnections - 1);
        });

        client.on("connectionCheckOutStarted", () => {
          this.pool.waitQueueSize++;
        });

        client.on("connectionCheckedOut", () => {
          this.pool.waitQueueSize = Math.max(0, this.pool.waitQueueSize - 1);
          this.pool.checkedOutConnections++;
        });

        client.on("connectionCheckOutFailed", () => {
          this.pool.waitQueueSize = Math.max(0, this.pool.waitQueueSize - 1);
        });

        client.on("connectionCheckedIn", () => {
          this.pool.checkedOutConnections = Math.max(0, this.pool.checkedOutConnections - 1);
        });

        // Command latency monitoring
        client.on("commandSucceeded", (event) => {
          const duration = event.duration || 0;
          this.commands.totalCommands++;
          this.commands.totalDurationMs += duration;
          this.commands.lastCommandDurationMs = Number(duration.toFixed(2));
          this.commands.avgLatencyMs = Number(
            (this.commands.totalDurationMs / this.commands.totalCommands).toFixed(2)
          );

          if (this.commands.recentSamples.length >= 20) {
            this.commands.recentSamples.shift();
          }
          this.commands.recentSamples.push(this.commands.lastCommandDurationMs);
        });

        client.on("commandFailed", (event) => {
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

  getMetrics() {
    return {
      pool: {
        activeConnections: this.pool.activeConnections,
        checkedOutConnections: this.pool.checkedOutConnections,
        totalCreated: this.pool.totalCreated,
        waitQueueSize: this.pool.waitQueueSize,
      },
      commands: {
        totalCommands: this.commands.totalCommands,
        failedCommands: this.commands.failedCommands,
        avgLatencyMs: this.commands.avgLatencyMs,
        lastCommandDurationMs: this.commands.lastCommandDurationMs,
      },
    };
  }
}

const dbMetrics = new DbMetrics();

module.exports = dbMetrics;
