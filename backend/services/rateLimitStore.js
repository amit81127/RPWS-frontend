// backend/services/rateLimitStore.js
// Multi-Instance Distributed Rate Limit Store backed by MongoDB with Resilient In-Memory Fallback

const mongoose = require("mongoose");
const logger = require("./logger");

/**
 * MongoRateLimitStore implements the express-rate-limit v7/v8 Store interface.
 * When multiple backend instances run (e.g. on Render or horizontal containers),
 * this store synchronizes rate limit counters across all instances via MongoDB.
 *
 * Resilience & Fallback:
 * If MongoDB is disconnected, buffering, or running in an offline test suite,
 * the store automatically and transparently falls back to an internal MemoryStore,
 * ensuring requests are never blocked or hung due to database state.
 */
class MongoRateLimitStore {
  constructor(options = {}) {
    this.prefix = options.prefix || "rl:";
    this.windowMs = options.windowMs || 60000;
    this.collectionName = options.collectionName || "rate_limits";
    this.inMemoryFallback = new Map();
    this.indexCreated = false;
    this.localKeys = false; // keys are shared across instances
  }

  /**
   * Called by express-rate-limit during initialization
   */
  init(options) {
    if (options && options.windowMs) {
      this.windowMs = options.windowMs;
    }
    this.ensureIndex().catch(() => {});
  }

  /**
   * Create TTL index on `expiresAt` so expired rate limit documents are
   * cleaned up automatically by MongoDB in the background.
   */
  async ensureIndex() {
    if (this.indexCreated) return;
    try {
      if (mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db) {
        const collection = mongoose.connection.db.collection(this.collectionName);
        await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        this.indexCreated = true;
      }
    } catch (err) {
      // Ignore if index already exists or background creation in progress
    }
  }

  /**
   * Atomic increment operation.
   * Uses a MongoDB update pipeline with conditional reset:
   * - If the record does not exist or its resetTime has passed: resets hits to 1 and sets new resetTime.
   * - If within the active window: increments hits by 1.
   */
  async increment(key) {
    const fullKey = `${this.prefix}${key}`;
    const now = new Date();
    const resetTime = new Date(now.getTime() + this.windowMs);

    const isStoreMongo = process.env.RATE_LIMIT_STORE !== "memory";
    const isDbConnected = Boolean(
      mongoose.connection &&
      mongoose.connection.readyState === 1 &&
      mongoose.connection.db
    );

    if (isStoreMongo && isDbConnected) {
      try {
        const collection = mongoose.connection.db.collection(this.collectionName);

        // Atomic pipeline update
        const result = await collection.findOneAndUpdate(
          { _id: fullKey },
          [
            {
              $set: {
                totalHits: {
                  $cond: {
                    if: {
                      $or: [
                        { $eq: ["$resetTime", null] },
                        { $lte: ["$resetTime", now] },
                      ],
                    },
                    then: 1,
                    else: { $add: [{ $ifNull: ["$totalHits", 0] }, 1] },
                  },
                },
                resetTime: {
                  $cond: {
                    if: {
                      $or: [
                        { $eq: ["$resetTime", null] },
                        { $lte: ["$resetTime", now] },
                      ],
                    },
                    then: resetTime,
                    else: "$resetTime",
                  },
                },
                expiresAt: {
                  $cond: {
                    if: {
                      $or: [
                        { $eq: ["$resetTime", null] },
                        { $lte: ["$resetTime", now] },
                      ],
                    },
                    then: resetTime,
                    else: "$resetTime",
                  },
                },
              },
            },
          ],
          { upsert: true, returnDocument: "after" }
        );

        // MongoDB Node.js driver compatibility: result or result.value
        const doc = result && result.value !== undefined ? result.value : result;
        if (doc && typeof doc.totalHits === "number") {
          return {
            totalHits: doc.totalHits,
            resetTime: doc.resetTime ? new Date(doc.resetTime) : resetTime,
          };
        }
      } catch (err) {
        logger.warn(
          { key: fullKey, err: err.message },
          "MongoRateLimitStore increment failed, using in-memory fallback"
        );
      }
    }

    // In-memory fallback
    return this.incrementMemory(fullKey, now, resetTime);
  }

  incrementMemory(fullKey, now, resetTime) {
    let client = this.inMemoryFallback.get(fullKey);
    if (!client || client.resetTime <= now) {
      client = { totalHits: 1, resetTime };
    } else {
      client.totalHits += 1;
    }
    this.inMemoryFallback.set(fullKey, client);
    return {
      totalHits: client.totalHits,
      resetTime: client.resetTime,
    };
  }

  async get(key) {
    const fullKey = `${this.prefix}${key}`;
    const now = new Date();

    const isStoreMongo = process.env.RATE_LIMIT_STORE !== "memory";
    const isDbConnected = Boolean(
      mongoose.connection &&
      mongoose.connection.readyState === 1 &&
      mongoose.connection.db
    );

    if (isStoreMongo && isDbConnected) {
      try {
        const collection = mongoose.connection.db.collection(this.collectionName);
        const doc = await collection.findOne({ _id: fullKey });
        if (doc && doc.resetTime && new Date(doc.resetTime) > now) {
          return {
            totalHits: doc.totalHits,
            resetTime: new Date(doc.resetTime),
          };
        }
      } catch (_) {}
    }

    const client = this.inMemoryFallback.get(fullKey);
    if (client && client.resetTime > now) {
      return {
        totalHits: client.totalHits,
        resetTime: client.resetTime,
      };
    }
    return undefined;
  }

  async decrement(key) {
    const fullKey = `${this.prefix}${key}`;
    const isStoreMongo = process.env.RATE_LIMIT_STORE !== "memory";
    const isDbConnected = Boolean(
      mongoose.connection &&
      mongoose.connection.readyState === 1 &&
      mongoose.connection.db
    );

    if (isStoreMongo && isDbConnected) {
      try {
        const collection = mongoose.connection.db.collection(this.collectionName);
        await collection.updateOne(
          { _id: fullKey, totalHits: { $gt: 0 } },
          { $inc: { totalHits: -1 } }
        );
      } catch (_) {}
    }

    const client = this.inMemoryFallback.get(fullKey);
    if (client && client.totalHits > 0) {
      client.totalHits -= 1;
    }
  }

  async resetKey(key) {
    const fullKey = `${this.prefix}${key}`;
    const isStoreMongo = process.env.RATE_LIMIT_STORE !== "memory";
    const isDbConnected = Boolean(
      mongoose.connection &&
      mongoose.connection.readyState === 1 &&
      mongoose.connection.db
    );

    if (isStoreMongo && isDbConnected) {
      try {
        const collection = mongoose.connection.db.collection(this.collectionName);
        await collection.deleteOne({ _id: fullKey });
      } catch (_) {}
    }

    this.inMemoryFallback.delete(fullKey);
  }

  async resetAll() {
    const isStoreMongo = process.env.RATE_LIMIT_STORE !== "memory";
    const isDbConnected = Boolean(
      mongoose.connection &&
      mongoose.connection.readyState === 1 &&
      mongoose.connection.db
    );

    if (isStoreMongo && isDbConnected) {
      try {
        const collection = mongoose.connection.db.collection(this.collectionName);
        await collection.deleteMany({ _id: { $regex: `^${this.prefix}` } });
      } catch (_) {}
    }

    this.inMemoryFallback.clear();
  }
}

module.exports = MongoRateLimitStore;
