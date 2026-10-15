// backend/middleware/errorHandler.js
// Centralized Express 5 Error Handling Middleware

const logger = require("../services/logger");

function errorHandler(err, req, res, next) {
  // If response headers have already been transmitted, delegate to default Express handler
  if (res.headersSent) {
    return next(err);
  }

  let status = err.status || err.statusCode || 500;
  let message = err.message || "An unexpected internal server error occurred.";

  // Handle Mongoose / MongoDB errors
  if (err.name === "CastError") {
    status = 400;
    message = `Invalid format for field: ${err.path || "identifier"}`;
  } else if (err.name === "ValidationError") {
    status = 400;
    const errorDetails = Object.values(err.errors || {})
      .map((e) => e.message)
      .filter(Boolean);
    message = errorDetails.length > 0 ? errorDetails.join("; ") : "Validation failed";
  } else if (err.code === 11000) {
    status = 409;
    message = "A duplicate record already exists with the provided information.";
  } else if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    // Malformed JSON payload
    status = 400;
    message = "Malformed JSON payload in request body.";
  } else if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    status = 401;
    message = "Invalid or expired authentication token.";
  } else if (err.code === "LIMIT_FILE_SIZE") {
    status = 400;
    message = "File too large. Maximum permitted image size is 5MB.";
  } else if (err.code === "INVALID_FILE_TYPE") {
    status = 400;
    message = err.message;
  } else if (err.type === "entity.too.large" || err.status === 413) {
    status = 413;
    message = "Payload too large. Request body exceeds permitted size limit.";
  } else if (err.name === "MongooseError" && typeof err.message === "string" && err.message.includes("buffering timed out")) {
    status = 503;
    message = "Database service is temporarily unavailable. Please retry shortly.";
  }

  // Log 5xx errors with stack trace and request metadata
  if (status >= 500) {
    logger.error(
      {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        err: {
          message: err.message,
          name: err.name,
          stack: err.stack,
        },
      },
      "Unhandled server error"
    );

    // Sanitize message in production to prevent leaking sensitive internals
    if (process.env.NODE_ENV === "production") {
      message = "An unexpected internal server error occurred.";
    }
  } else {
    logger.warn(
      {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        status,
        message,
      },
      `Client error: ${status}`
    );
  }

  res.status(status).json({ error: message });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.originalUrl || req.url}`,
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
};
