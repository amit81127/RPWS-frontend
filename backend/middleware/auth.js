const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: JWT_SECRET environment variable is missing in production.");
    }
    // Only permit explicit test fallback when in test environment
    if (process.env.NODE_ENV === "test") {
      return "test-jwt-secret-for-jest-only";
    }
    throw new Error("FATAL: JWT_SECRET environment variable must be set in .env.");
  }
  return secret;
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided or invalid format" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Access denied: Administrator privileges required" });
  }
  next();
}

module.exports = {
  authMiddleware,
  adminOnly,
  getJwtSecret,
};