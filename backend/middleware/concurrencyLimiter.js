// backend/middleware/concurrencyLimiter.js
// Bounded Concurrency Limiter for Resource-Intensive Operations

const logger = require("../services/logger");

/**
 * Creates an Express middleware that bounds concurrent in-flight executions
 * of heavy operations (e.g. vote reconciliation, image base64 streaming).
 *
 * Fast-Fail & Bounded Queue:
 * - If in-flight count < maxConcurrent: executes immediately.
 * - If maxConcurrent is reached: enqueues up to maxQueue items with a strict timeout.
 * - If queue is full: immediately returns HTTP 429 Too Many Requests with Retry-After header.
 * - If queued item exceeds queueTimeoutMs: fast-fails with 429, preventing request pileups.
 *
 * Isolation:
 * This limiter MUST NOT be applied to critical paths like /health, /login, or /voteParticipant/:id.
 */
function createConcurrencyLimiter(options = {}) {
  const {
    maxConcurrent = 5,
    maxQueue = 10,
    queueTimeoutMs = 5000,
    resourceName = "Operation",
    retryAfterSeconds = 5,
  } = options;

  let activeCount = 0;
  const queue = [];

  const release = () => {
    activeCount = Math.max(0, activeCount - 1);
    while (queue.length > 0 && activeCount < maxConcurrent) {
      const nextTask = queue.shift();
      if (nextTask && !nextTask.expired) {
        nextTask.run();
        break;
      }
    }
  };

  const middleware = (req, res, next) => {
    // 1. Available concurrency slot -> proceed immediately
    if (activeCount < maxConcurrent) {
      activeCount++;
      let released = false;
      const onDone = () => {
        if (!released) {
          released = true;
          release();
        }
      };
      res.on("finish", onDone);
      res.on("close", onDone);
      return next();
    }

    // 2. Queue full -> Reject immediately with 429
    if (queue.length >= maxQueue) {
      logger.warn(
        {
          resource: resourceName,
          activeCount,
          queueLength: queue.length,
          url: req.originalUrl,
        },
        `${resourceName} queue is full. Rejecting request to prevent resource exhaustion.`
      );

      res.setHeader("Retry-After", retryAfterSeconds.toString());
      return res.status(429).json({
        error: `${resourceName} is currently under high load. Please try again in a few moments.`,
        retryAfterSeconds,
      });
    }

    // 3. Queue available -> Enqueue with bounded timeout
    let timer = null;
    const task = {
      expired: false,
      run: () => {
        if (timer) clearTimeout(timer);
        activeCount++;
        let released = false;
        const onDone = () => {
          if (!released) {
            released = true;
            release();
          }
        };
        res.on("finish", onDone);
        res.on("close", onDone);
        next();
      },
    };

    timer = setTimeout(() => {
      task.expired = true;
      const idx = queue.indexOf(task);
      if (idx !== -1) {
        queue.splice(idx, 1);
      }

      logger.warn(
        {
          resource: resourceName,
          activeCount,
          queueLength: queue.length,
          url: req.originalUrl,
        },
        `${resourceName} queue wait timed out after ${queueTimeoutMs}ms.`
      );

      if (!res.headersSent) {
        res.setHeader("Retry-After", retryAfterSeconds.toString());
        res.status(429).json({
          error: `${resourceName} server queue timed out. Please retry shortly.`,
          retryAfterSeconds,
        });
      }
    }, queueTimeoutMs);

    queue.push(task);
  };

  middleware.getActiveCount = () => activeCount;
  middleware.getQueueLength = () => queue.length;
  middleware.reset = () => {
    activeCount = 0;
    queue.length = 0;
  };

  return middleware;
}

module.exports = createConcurrencyLimiter;
