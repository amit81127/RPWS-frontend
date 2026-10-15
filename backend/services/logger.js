// backend/services/logger.js
// Production-grade structured logger with sensitive data redaction

const SENSITIVE_KEYS = new Set([
  "password",
  "adminkey",
  "admin_secret_key",
  "newpassword",
  "token",
  "secret",
  "jwt_secret",
  "authorization",
  "cookie",
  "set-cookie",
  "accesstoken",
  "refreshtoken",
]);

/**
 * Recursively redacts sensitive keys from an object to prevent credential leakage.
 */
function redact(obj, depth = 0) {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item, depth + 1));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = redact(value, depth + 1);
    } else if (typeof value === "string" && lowerKey.includes("url") && value.includes("mongodb+srv://")) {
      // Redact Mongo credentials if embedded in URL
      sanitized[key] = value.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+(@.+)/, "$1***$2");
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const currentLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");
const minLevelValue = LOG_LEVELS[currentLevel] || LOG_LEVELS.info;

function formatLog(level, data, message) {
  const timestamp = new Date().toISOString();
  const sanitizedData = typeof data === "object" && data !== null ? redact(data) : data;

  if (process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json") {
    const entry = {
      timestamp,
      level,
      message,
      ...(typeof sanitizedData === "object" && sanitizedData !== null ? sanitizedData : { data: sanitizedData }),
    };
    return JSON.stringify(entry);
  }

  // Development/Test formatted output
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (sanitizedData && Object.keys(sanitizedData).length > 0) {
    return `${prefix} ${message} ${JSON.stringify(sanitizedData)}`;
  }
  return `${prefix} ${message}`;
}

const logger = {
  debug(data, message = "") {
    if (LOG_LEVELS.debug >= minLevelValue) {
      if (typeof data === "string" && !message) {
        message = data;
        data = {};
      }
      console.debug(formatLog("debug", data, message));
    }
  },
  info(data, message = "") {
    if (LOG_LEVELS.info >= minLevelValue) {
      if (typeof data === "string" && !message) {
        message = data;
        data = {};
      }
      console.log(formatLog("info", data, message));
    }
  },
  warn(data, message = "") {
    if (LOG_LEVELS.warn >= minLevelValue) {
      if (typeof data === "string" && !message) {
        message = data;
        data = {};
      }
      console.warn(formatLog("warn", data, message));
    }
  },
  error(data, message = "") {
    if (LOG_LEVELS.error >= minLevelValue) {
      if (typeof data === "string" && !message) {
        message = data;
        data = {};
      }
      console.error(formatLog("error", data, message));
    }
  },
  fatal(data, message = "") {
    if (LOG_LEVELS.fatal >= minLevelValue) {
      if (typeof data === "string" && !message) {
        message = data;
        data = {};
      }
      console.error(formatLog("fatal", data, message));
    }
  },
  redact,
};

module.exports = logger;
