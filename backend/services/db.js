// backend/services/db.js
// Singleton MongoDB Connection Manager for ExpoVote

const mongoose = require("mongoose");
const logger = require("./logger");
const dbMetrics = require("./dbMetrics");

let connectionPromise = null;

/**
 * Production-Calibrated Connection Pool Sizing:
 * - Max Expected Backend Instances: 10 (Render autoscaling ceiling)
 * - Max Pool per Instance: 25
 * - Total Web Tier Capacity: 10 * 25 = 250 connections
 * - Background Tasks / CLI: 5 connections
 * - Atlas Replica Set System Overhead: ~30 connections
 * - Peak Cluster Connections: 285 <= 500 (strictly safe for MongoDB Atlas M0/M2/M5 tiers)
 * - Throughput Headroom: At 2.5ms avg latency, 25 connections sustain 10,000 ops/sec per instance
 */
const DEFAULT_POOL_CONFIG = {
  serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10) || 10000,
  maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE, 10) || 25,
  minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE, 10) || 5,
  maxIdleTimeMS: 30000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 15000,
  waitQueueTimeoutMS: 5000, // Fail fast on pool starvation (5s) instead of 10s backlog
  monitorCommands: true,
};

const CONNECTION_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

/**
 * Attaches global lifecycle event listeners to the Mongoose default connection once.
 */
let listenersAttached = false;
function setupConnectionListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on("connected", () => {
    logger.info({ host: mongoose.connection.host, name: mongoose.connection.name }, "MongoDB connected successfully");
  });

  mongoose.connection.on("error", (err) => {
    logger.error({ err: { message: err.message, name: err.name } }, "MongoDB connection error encountered");
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB connection disconnected");
  });

  mongoose.connection.on("reconnected", () => {
    logger.info("MongoDB connection reconnected");
  });

  // Instrument connection for pool and latency telemetry
  dbMetrics.instrument(mongoose.connection);
}

/**
 * Connect to MongoDB once per process and reuse the connection.
 * Concurrent callers receive the same connection Promise.
 *
 * @param {string} [mongoUrl] - MongoDB connection string URI
 * @param {object} [customOptions] - Optional overrides for Mongoose options
 * @returns {Promise<import("mongoose").Connection>}
 */
async function connectDB(mongoUrl, customOptions = {}) {
  setupConnectionListeners();

  // If already connected, reuse existing connection immediately
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // If already connecting, await existing in-flight promise
  if (mongoose.connection.readyState === 2 && connectionPromise) {
    return connectionPromise;
  }

  const effectiveUrl =
    mongoUrl ||
    process.env.MONGO_URL ||
    (process.env.NODE_ENV === "production" ? null : "mongodb://127.0.0.1:27017/ratingdb");

  if (!effectiveUrl) {
    const errorMsg = "FATAL: MONGO_URL environment variable is required in production.";
    logger.fatal(errorMsg);
    throw new Error(errorMsg);
  }

  const options = {
    ...DEFAULT_POOL_CONFIG,
    ...customOptions,
  };

  mongoose.set("strictQuery", false);
  mongoose.set("bufferTimeoutMS", 3000); // Fail fast after 3 seconds if disconnected instead of waiting 10s

  connectionPromise = mongoose
    .connect(effectiveUrl, options)
    .then((m) => {
      return m.connection;
    })
    .catch((err) => {
      connectionPromise = null;
      logger.error({ err: { message: err.message, name: err.name } }, "Initial MongoDB connection failed");
      throw err;
    });

  return connectionPromise;
}

/**
 * Closes the MongoDB connection gracefully within a bounded timeout.
 *
 * @param {boolean} [force=false] - Whether to forcefully close immediately
 * @param {number} [timeoutMs=5000] - Timeout in milliseconds before forcing close
 * @returns {Promise<void>}
 */
async function closeDB(force = false, timeoutMs = 5000) {
  if (mongoose.connection.readyState === 0) {
    connectionPromise = null;
    return;
  }

  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      logger.warn("MongoDB close timed out, forcing disconnect");
      resolve();
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  try {
    await Promise.race([
      mongoose.connection.close(force),
      timeoutPromise,
    ]);
  } catch (err) {
    logger.error({ err: { message: err.message } }, "Error closing MongoDB connection");
  } finally {
    if (timer) clearTimeout(timer);
    connectionPromise = null;
  }
}

/**
 * Returns safe connection status without exposing connection string or credentials.
 *
 * @returns {{ isConnected: boolean, state: string, readyState: number }}
 */
function getDbHealth() {
  const readyState = mongoose.connection.readyState;
  return {
    isConnected: readyState === 1,
    state: CONNECTION_STATES[readyState] || "unknown",
    readyState,
  };
}

module.exports = {
  connectDB,
  closeDB,
  getDbHealth,
  mongoose,
};
