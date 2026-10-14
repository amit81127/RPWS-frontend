const rateLimit = require("express-rate-limit");

/**
 * Express Rate Limiting Configuration for ExpoVote / Gandhigiri
 *
 * Deployment Topology: Render Web Service behind 1 reverse proxy hop (Cloudflare/Render router).
 * Proxy Handling: Express configured with `trust proxy: 1` to resolve client IP from Render.
 * Scope: In-Memory (MemoryStore) within this Node.js process. Limits are process-local
 *        and not shared across multi-container horizontal replicas (no Redis dependency).
 *
 * College Expo Wi-Fi / NAT Protection:
 *   - Authenticated voting uses cryptographically verified JWT user ID as the rate limit key.
 *     This ensures students sharing the college Wi-Fi public IP address do NOT throttle each other.
 *   - Unauthenticated routes use client IP.
 */

const getLimit = (envVar, testDefault, prodDefault) => {
  if (process.env[envVar]) {
    const parsed = parseInt(process.env[envVar], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return process.env.NODE_ENV === "test" ? testDefault : prodDefault;
};

// 1. Authentication Limiter (POST /login, POST /signup)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: () => getLimit("RATE_LIMIT_AUTH_MAX", 100, 15),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts. Please try again in 15 minutes.",
  },
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json(options.message);
  },
});

// 2. Project Registration Limiter (POST /addParticipants)
// Runs before Multer to prevent Cloudinary upload quota exhaustion
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: () => getLimit("RATE_LIMIT_UPLOAD_MAX", 100, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many project registration attempts. Please try again later.",
  },
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json(options.message);
  },
});

// 3. Voting Limiter (POST /voteParticipant/:id)
// Placed after authMiddleware so req.user.id is verified and tamper-proof.
const voteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute window
  max: () => getLimit("RATE_LIMIT_VOTE_MAX", 100, 30),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    // Authenticated voter ID from verified JWT (prevents college Wi-Fi NAT throttling)
    if (req.user && req.user.id) {
      return `voter_${req.user.id}`;
    }
    return req.ip;
  },
  message: {
    error: "Too many voting attempts. Please wait a moment before trying again.",
  },
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json(options.message);
  },
});

// 4. Public Read Limiter (GET /allParticipants, GET /allParticipantsByVotes)
const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1-minute window
  max: () => getLimit("RATE_LIMIT_READ_MAX", 500, 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please slow down.",
  },
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json(options.message);
  },
});

module.exports = {
  authLimiter,
  uploadLimiter,
  voteLimiter,
  readLimiter,
};
