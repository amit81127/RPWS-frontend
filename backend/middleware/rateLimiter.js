// backend/middleware/rateLimiter.js
// Production Rate Limiting & Overload Protection for ExpoVote / Gandhigiri

const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const MongoRateLimitStore = require("../services/rateLimitStore");

/**
 * ExpoVote Rate Limiting Topology:
 * - Reverse Proxy: Render / Cloudflare with `trust proxy: 1`. Client IP resolved from X-Forwarded-For.
 * - Distributed Scaling: Multi-instance synchronization via MongoRateLimitStore (MongoDB Atlas collection with TTL index).
 *   Transparent in-memory fallback when database is offline or in test environments.
 * - Campus Wi-Fi NAT Immunity:
 *   - Voting (`voteLimiter`): Keys by verified JWT `req.user.id` so students on the same public Wi-Fi IP do NOT throttle each other.
 *   - Login (`loginLimiter`): Keys by normalized account email (`login_<email>`) so one user's failed attempts never lock out other students.
 *   - Reads (`readLimiter`): Keys by JWT `reader_<id>` with generous shared IP fallback (10,000 req/min) for public exhibition viewing.
 */

const getLimit = (envVar, testDefault, prodDefault) => {
  if (process.env[envVar]) {
    const parsed = parseInt(process.env[envVar], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return process.env.NODE_ENV === "test" ? testDefault : prodDefault;
};

/**
 * Standardized HTTP 429 response handler.
 * Guarantees RFC 6585 compliance with `Retry-After` header and structured JSON error payload.
 */
const create429Handler = (defaultMessage) => (req, res, next, options) => {
  const windowMs =
    typeof options.windowMs === "function"
      ? options.windowMs(req, res)
      : options.windowMs || 60000;

  const resetTime =
    req.rateLimit && req.rateLimit.resetTime
      ? req.rateLimit.resetTime
      : new Date(Date.now() + windowMs);

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((resetTime.getTime() - Date.now()) / 1000)
  );

  res.setHeader("Retry-After", retryAfterSeconds.toString());
  res.status(options.statusCode || 429).json({
    error:
      defaultMessage ||
      (options.message && options.message.error) ||
      "Too many requests. Please slow down and try again.",
    retryAfterSeconds,
    limit: req.rateLimit ? req.rateLimit.limit : undefined,
    remaining: 0,
    resetTime: resetTime.toISOString(),
  });
};

/**
 * Factory to instantiate an express-rate-limit instance with MongoRateLimitStore.
 */
function createLimiter(config) {
  const {
    prefix,
    windowMs,
    max,
    message,
    keyGenerator,
    validate = {},
  } = config;

  const store =
    process.env.RATE_LIMIT_STORE === "memory"
      ? undefined // defaults to internal MemoryStore
      : new MongoRateLimitStore({ prefix, windowMs });

  return rateLimit({
    windowMs,
    max,
    store,
    standardHeaders: true, // draft-7 RateLimit-* headers
    legacyHeaders: false,
    validate: {
      keyGeneratorIpFallback: false,
      unsharedStore: false,
      ...validate,
    },
    keyGenerator,
    message: { error: message },
    handler: create429Handler(message),
  });
}

// 1. Login Limiter (POST /login)
// Account-keyed brute force defense with campus Wi-Fi NAT protection.
const loginLimiter = createLimiter({
  prefix: "login:",
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: () => getLimit("RATE_LIMIT_LOGIN_MAX", 10, 30),
  keyGenerator: (req) => {
    if (req.body && req.body.email && typeof req.body.email === "string") {
      const email = req.body.email.trim().toLowerCase();
      if (email) return `login_email_${email}`;
    }
    return `login_ip_${req.ip}`;
  },
  message: "Too many login attempts for this account. Please wait 15 minutes before trying again.",
});

// 2. Signup Limiter (POST /signup)
// IP-keyed protection to prevent mass account creation while accommodating campus lab signups.
const signupLimiter = createLimiter({
  prefix: "signup:",
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: () => getLimit("RATE_LIMIT_SIGNUP_MAX", 10, 60),
  keyGenerator: (req) => `signup_ip_${req.ip}`,
  message: "Too many accounts created from this IP. Please try again in 15 minutes.",
});

// 3. General Auth Limiter (Admin signup / registration)
const authLimiter = createLimiter({
  prefix: "auth:",
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: () => getLimit("RATE_LIMIT_AUTH_MAX", 20, 100),
  keyGenerator: (req) => `auth_ip_${req.ip}`,
  message: "Too many authentication attempts. Please try again in 15 minutes.",
});

// 4. Project Registration Limiter (POST /addParticipants)
// Runs before Multer file-handling to prevent Cloudinary and disk storage exhaustion.
const uploadLimiter = createLimiter({
  prefix: "upload:",
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: () => getLimit("RATE_LIMIT_UPLOAD_MAX", 20, 100),
  keyGenerator: (req) => {
    if (req.user && req.user.id) return `upload_user_${req.user.id}`;
    return `upload_ip_${req.ip}`;
  },
  message: "Too many project registration attempts. Please try again later.",
});

// 5. Voting Limiter (POST /voteParticipant/:id)
// Placed after authMiddleware so req.user.id is verified.
// Campus NAT safe: Students sharing campus Wi-Fi have separate user IDs and do not throttle each other.
const voteLimiter = createLimiter({
  prefix: "vote:",
  windowMs: 60 * 1000, // 1 minute
  max: () => getLimit("RATE_LIMIT_VOTE_MAX", 50, 240),
  keyGenerator: (req) => {
    if (req.user && req.user.id) {
      return `voter_${req.user.id}`;
    }
    return `vote_ip_${req.ip}`;
  },
  message: "Too many voting attempts. Please wait a moment before trying again.",
});

// 6. Public Read Limiter (GET /allParticipants, GET /allParticipantsByVotes, GET /participant/:id, GET /myVotes)
// Authenticated students get distinct reader_<id> quota.
// Public visitors on shared campus Wi-Fi get a generous 10,000 req/min pool.
const readLimiter = createLimiter({
  prefix: "read:",
  windowMs: 60 * 1000, // 1 minute
  max: () => getLimit("RATE_LIMIT_READ_MAX", 500, 10000),
  keyGenerator: (req) => {
    if (req.user && req.user.id) {
      return `reader_${req.user.id}`;
    }
    if (
      req.headers &&
      req.headers.authorization &&
      typeof req.headers.authorization === "string" &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      try {
        const token = req.headers.authorization.split(" ")[1];
        const decoded = jwt.decode(token);
        if (decoded && (decoded.id || decoded._id)) {
          return `reader_${decoded.id || decoded._id}`;
        }
      } catch (_) {}
    }
    return `read_ip_${req.ip}`;
  },
  message: "Too many requests. Please slow down.",
});

// 7. Expensive Admin Operations Limiter (/admin/reconcileVotes, /admin/startVoting, etc.)
const adminLimiter = createLimiter({
  prefix: "admin:",
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: () => getLimit("RATE_LIMIT_ADMIN_MAX", 30, 120),
  keyGenerator: (req) => {
    if (req.user && req.user.id) return `admin_${req.user.id}`;
    return `admin_ip_${req.ip}`;
  },
  message: "Too many administrative requests. Please wait a few moments before trying again.",
});

// 8. Image Streaming Limiter (/participantImage/:id)
const imageStreamLimiter = createLimiter({
  prefix: "img:",
  windowMs: 60 * 1000, // 1 minute
  max: () => getLimit("RATE_LIMIT_IMAGE_MAX", 100, 1200),
  keyGenerator: (req) => `img_ip_${req.ip}`,
  message: "Image request rate exceeded. Please slow down.",
});

module.exports = {
  createLimiter,
  loginLimiter,
  signupLimiter,
  authLimiter,
  uploadLimiter,
  voteLimiter,
  readLimiter,
  adminLimiter,
  imageStreamLimiter,
  create429Handler,
};
