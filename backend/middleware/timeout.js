// backend/middleware/timeout.js
// Safe bounded request timeout middleware with header guard and timer cleanup

const logger = require("../services/logger");

const DEFAULT_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 25000;

function createTimeoutMiddleware(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return function requestTimeout(req, res, next) {
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    timer = setTimeout(() => {
      req.timedOut = true;
      if (!res.headersSent) {
        logger.warn(
          {
            requestId: req.id,
            method: req.method,
            url: req.originalUrl,
            timeoutMs,
          },
          "Request timed out"
        );
        res.status(503).json({
          error: "Request timeout: Operation took too long to complete.",
        });
      }
    }, timeoutMs);

    if (timer.unref) {
      timer.unref();
    }

    res.on("finish", cleanup);
    res.on("close", cleanup);

    next();
  };
}

module.exports = createTimeoutMiddleware;
module.exports.defaultTimeout = createTimeoutMiddleware();
