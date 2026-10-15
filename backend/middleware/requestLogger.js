// backend/middleware/requestLogger.js
// Structured request logger with latency measurements and sensitive query redaction

const crypto = require("crypto");
const logger = require("../services/logger");

const SENSITIVE_QUERY_PARAMS = new Set([
  "token",
  "secret",
  "key",
  "adminkey",
  "password",
  "auth",
]);

/**
 * Strips sensitive query parameter values from URL paths for logging.
 */
function sanitizeUrl(originalUrl) {
  if (!originalUrl) return "/";
  try {
    const urlObj = new URL(originalUrl, "http://localhost");
    let changed = false;
    for (const key of urlObj.searchParams.keys()) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        urlObj.searchParams.set(key, "[REDACTED]");
        changed = true;
      }
    }
    return changed ? `${urlObj.pathname}?${urlObj.searchParams.toString()}` : originalUrl;
  } catch (_) {
    return originalUrl;
  }
}

function requestLogger(req, res, next) {
  // Generate or propagate request ID
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startNs = process.hrtime.bigint();

  let logged = false;
  const logResponse = () => {
    if (logged) return;
    logged = true;

    const endNs = process.hrtime.bigint();
    const durationMs = Number(endNs - startNs) / 1e6;

    const logPayload = {
      requestId: req.id,
      method: req.method,
      url: sanitizeUrl(req.originalUrl || req.url),
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip,
    };

    if (res.statusCode >= 500) {
      logger.error(logPayload, `HTTP ${req.method} ${logPayload.url} -> ${res.statusCode} (${logPayload.durationMs}ms)`);
    } else if (res.statusCode >= 400) {
      logger.warn(logPayload, `HTTP ${req.method} ${logPayload.url} -> ${res.statusCode} (${logPayload.durationMs}ms)`);
    } else {
      // In production, avoid spamming logs with frequent health check pings if healthy
      if (req.path === "/health" && process.env.NODE_ENV === "production" && res.statusCode === 200) {
        return;
      }
      logger.info(logPayload, `HTTP ${req.method} ${logPayload.url} -> ${res.statusCode} (${logPayload.durationMs}ms)`);
    }
  };

  res.on("finish", logResponse);
  res.on("close", logResponse);

  next();
}

module.exports = requestLogger;
module.exports.sanitizeUrl = sanitizeUrl;
