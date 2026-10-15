// backend/index.js
// ExpoVote Production Reliability Hardened Express Server

process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || "64";
require("dotenv").config();

const express = require("express");
const compression = require("compression");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const { ParticipantsModel } = require("./models/participantsModels");
const User = require("./models/userModel");
const VoteModel = require("./models/voteModel");
const SettingModel = require("./models/settingModel");
const { authMiddleware, adminOnly, getJwtSecret } = require("./middleware/auth");
const { handleUpload, cloudinary } = require("./middleware/upload");
const {
  reconcileVotes,
  isVotingEnabled,
  isVotingEnabledSync,
  setVotingEnabled,
  recordVoteActivity,
  getLastVoteActivity,
} = require("./services/voteService");
const {
  loginLimiter,
  signupLimiter,
  authLimiter,
  uploadLimiter,
  voteLimiter,
  readLimiter,
  adminLimiter,
  imageStreamLimiter,
} = require("./middleware/rateLimiter");
const createConcurrencyLimiter = require("./middleware/concurrencyLimiter");
const dbMetrics = require("./services/dbMetrics");
const { publicFeedCache, createCacheKey } = require("./services/cacheService");

// Production Reliability Enhancements
const logger = require("./services/logger");
const { connectDB, closeDB, getDbHealth } = require("./services/db");
const requestLogger = require("./middleware/requestLogger");
const createTimeoutMiddleware = require("./middleware/timeout");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const PORT = parseInt(process.env.PORT, 10) || 5000;
const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL && process.env.NODE_ENV === "production") {
  logger.fatal("FATAL: MONGO_URL environment variable is required in production.");
  process.exit(1);
}

const effectiveMongoUrl = MONGO_URL || "mongodb://127.0.0.1:27017/ratingdb";

const app = express();

// Trust Render's single upstream reverse proxy hop (Cloudflare / Render load balancer)
app.set("trust proxy", 1);

// ---------- Server State & In-Flight Request Tracking ----------
let server = null;
let isShuttingDown = false;
let activeRequests = 0;
let drainResolve = null;

// Middleware: Reject new requests during graceful shutdown and track in-flight requests
app.use((req, res, next) => {
  if (isShuttingDown) {
    res.setHeader("Connection", "close");
    return res.status(503).json({
      error: "Server is shutting down. Please retry your request shortly.",
    });
  }

  activeRequests++;
  let decremented = false;
  const onDone = () => {
    if (!decremented) {
      decremented = true;
      activeRequests = Math.max(0, activeRequests - 1);
      if (isShuttingDown && activeRequests === 0 && drainResolve) {
        drainResolve();
      }
    }
  };

  res.on("finish", onDone);
  res.on("close", onDone);
  next();
});

// ---------- 1. CORS Configuration (Registered FIRST) ----------
const ALLOWED_ORIGINS = [
  "https://aitm-vote.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// Support comma-separated FRONTEND_URL environment variable
if (process.env.FRONTEND_URL) {
  process.env.FRONTEND_URL.split(",").forEach((origin) => {
    const trimmed = origin.trim().replace(/\/+$/, "");
    if (trimmed && !ALLOWED_ORIGINS.includes(trimmed)) {
      ALLOWED_ORIGINS.push(trimmed);
    }
  });
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. curl, health checks, server-to-server)
    if (!origin) return callback(null, true);

    const isExplicitlyAllowed = ALLOWED_ORIGINS.includes(origin);
    const isVercelPreview = /^https:\/\/aitm-vote[a-z0-9-]*\.vercel\.app$/.test(origin);

    if (isExplicitlyAllowed || isVercelPreview) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Cache-Control",
    "X-Request-Id",
  ],
  exposedHeaders: ["Content-Length", "X-Cache", "ETag", "X-Request-Id"],
  credentials: true,
  optionsSuccessStatus: 200,
  maxAge: 86400,
};

app.use(cors(corsOptions));
// In Express 5, wildcard route for options uses regex /(.*)/
app.options(/(.*)/, cors(corsOptions));

// ---------- 2. Structured Request Logging & Latency Measurement ----------
app.use(requestLogger);

// ---------- 3. Body Parsing, Compression & Static Assets ----------
// Gzip / Brotli compression for fast payload delivery
app.use(
  compression({
    threshold: 1024, // Compress responses larger than 1KB
  })
);

// Strict JSON body parser bounded to 16KB to prevent oversized bodies from consuming memory
const strictJsonParser = express.json({ limit: "16kb" });
app.use(strictJsonParser);

// Dedicated Bounded Concurrency Limiters for heavy workloads
const reconcileConcurrency = createConcurrencyLimiter({
  maxConcurrent: 2,
  maxQueue: 5,
  queueTimeoutMs: 5000,
  resourceName: "Vote reconciliation",
  retryAfterSeconds: 5,
});

const imageStreamConcurrency = createConcurrencyLimiter({
  maxConcurrent: 25,
  maxQueue: 50,
  queueTimeoutMs: 5000,
  resourceName: "Image streaming",
  retryAfterSeconds: 5,
});

// Serve static uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Request timeout middleware (25s ceiling to prevent connection socket exhaustion)
const requestTimeoutMs = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 25000;
app.use(createTimeoutMiddleware(requestTimeoutMs));

// Helper: Escape user input for safe regular expressions to eliminate ReDoS vulnerabilities
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Helpers: Check if database connection is active to prevent request buffering and pileups
function isDbAvailable() {
  return mongoose.connection.readyState === 1;
}

function checkDbAvailable() {
  if (!isDbAvailable()) {
    const err = new Error("Database service is temporarily unavailable. Please retry shortly.");
    err.status = 503;
    throw err;
  }
}

// Helper: Normalize image URLs to avoid sending multi-megabyte Base64 strings in list responses
function resolveImageUrl(req, rawImage, participantId) {
  if (!rawImage) {
    return "https://via.placeholder.com/300";
  }

  // Disk upload
  if (rawImage.startsWith("/uploads/") || rawImage.startsWith("participant-")) {
    const relativePath = rawImage.startsWith("/uploads/") ? rawImage : `/uploads/${rawImage}`;
    return `${req.protocol}://${req.get("host")}${relativePath}`;
  }

  // Giant legacy Base64 Data URI -> Stream through dedicated cached image endpoint
  if (rawImage.startsWith("data:image/")) {
    return `${req.protocol}://${req.get("host")}/participantImage/${participantId}`;
  }

  // Cloudinary CDN: apply responsive dimensions, auto-format (WebP/AVIF) and quality compression
  if (rawImage.includes("res.cloudinary.com") && rawImage.includes("/image/upload/")) {
    if (!rawImage.includes("/image/upload/f_auto")) {
      return rawImage.replace(
        "/image/upload/",
        "/image/upload/f_auto,q_auto,w_500,c_limit/"
      );
    }
  }

  // External URL
  return rawImage;
}

// ---------- IMAGE STREAMING / CACHING ENDPOINT ----------
app.get("/participantImage/:id", imageStreamLimiter, imageStreamConcurrency, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !isDbAvailable()) {
      return res.redirect("https://via.placeholder.com/300");
    }

    const participant = await ParticipantsModel.findById(id, { image: 1 }).maxTimeMS(5000).lean();
    if (!participant || !participant.image) {
      return res.redirect("https://via.placeholder.com/300");
    }

    if (participant.image.startsWith("data:image/")) {
      // Guard against unbounded memory allocation from massive base64 payloads
      if (participant.image.length > 10 * 1024 * 1024) {
        return res.redirect("https://via.placeholder.com/300");
      }
      const commaIndex = participant.image.indexOf(",");
      if (commaIndex !== -1) {
        const header = participant.image.substring(0, commaIndex);
        const base64Data = participant.image.substring(commaIndex + 1);
        const mimeMatch = header.match(/^data:([^;]+)/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
        const buffer = Buffer.from(base64Data, "base64");
        res.setHeader("Content-Type", mimeType);
        res.setHeader("Cache-Control", "public, max-age=86400, immutable"); // 24-hour browser & CDN cache
        return res.send(buffer);
      }
    }

    if (participant.image.startsWith("/uploads/")) {
      return res.redirect(participant.image);
    }

    return res.redirect(participant.image);
  } catch (err) {
    return res.redirect("https://via.placeholder.com/300");
  }
});

// ---------- AUTH ROUTES ----------

// Signup (only student role allowed; passwords hashed once via UserSchema pre-save)
app.post("/signup", signupLimiter, strictJsonParser, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: "Invalid email address format" });
    }

    checkDbAvailable();
    const exists = await User.findOne({ email: normalizedEmail }, { _id: 1 }).lean();
    if (exists) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Role is strictly hardcoded to 'student'; clients cannot self-assign admin
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: "student",
    });

    const secret = getJwtSecret();
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      secret,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "Account created successfully",
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// Login (account-keyed rate limiting with strict body parser)
app.post("/login", strictJsonParser, loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email & password required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    checkDbAvailable();
    const user = await User.findOne(
      { email: normalizedEmail },
      { name: 1, email: 1, password: 1, role: 1 }
    );
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const ok = await user.comparePassword(password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const secret = getJwtSecret();
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      secret,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- PARTICIPANT ROUTES ----------

// Add Participant (with rate limiting, JWT authentication, disk upload protection & 5MB max limit)
app.post("/addParticipants", uploadLimiter, authMiddleware, handleUpload, async (req, res, next) => {
  try {
    const { name, department, projectName, email, description, teamNo } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      if (req.file && (req.file.filename || req.file.public_id)) {
        try {
          await cloudinary.uploader.destroy(req.file.filename || req.file.public_id);
        } catch (_) {}
      }
      if (req.file && req.file.path && !req.file.path.startsWith("http")) {
        try {
          if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        } catch (_) {}
      }
      return res.status(400).json({ error: "name is required" });
    }

    // Reconcile department and projectName for backward compatibility
    const resolvedDept = (department || projectName || "").trim();
    const resolvedProject = (projectName || department || "").trim();

    let image = "https://via.placeholder.com/300";
    if (req.file) {
      if (req.file.path && (req.file.path.startsWith("http://") || req.file.path.startsWith("https://"))) {
        image = req.file.path;
      } else if (req.file.secure_url) {
        image = req.file.secure_url;
      } else if (req.file.filename) {
        image = `/uploads/${req.file.filename}`;
      } else if (req.file.path) {
        image = req.file.path;
      }
    } else if (req.body.image && typeof req.body.image === "string" && !req.body.image.includes("example.com")) {
      image = req.body.image.trim();
    }

    let resolvedTeamNo = undefined;
    if (teamNo !== undefined && teamNo !== null && String(teamNo).trim() !== "") {
      const digitsOnly = String(teamNo).replace(/\D+/g, "");
      const parsed = parseInt(digitsOnly || teamNo, 10);
      if (!isNaN(parsed)) {
        resolvedTeamNo = parsed;
      }
    }

    checkDbAvailable();
    const participant = await ParticipantsModel.create({
      name: name.trim(),
      department: resolvedDept,
      projectName: resolvedProject,
      email: email ? String(email).trim() : undefined,
      description: description ? String(description).trim() : "",
      teamNo: resolvedTeamNo,
      image,
    });

    // Invalidate public feed cache on participant creation
    publicFeedCache.clear();

    res.status(201).json({
      message: "Participant added",
      data: {
        ...participant.toObject(),
        image: resolveImageUrl(req, participant.image, participant._id),
      },
    });
  } catch (err) {
    if (req.file && (req.file.filename || req.file.public_id)) {
      try {
        await cloudinary.uploader.destroy(req.file.filename || req.file.public_id);
      } catch (_) {}
    }
    if (req.file && req.file.path && !req.file.path.startsWith("http")) {
      try {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (_) {}
    }
    next(err);
  }
});

// Get all participants (with rate limiting, server-enforced pagination max limit 50, stampede-proof TTL caching & lightweight image URLs)
app.get("/allParticipants", readLimiter, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 50);
    const rawSearch = (req.query.search ? String(req.query.search).trim() : "").slice(0, 100);
    const department = (req.query.department ? String(req.query.department).trim() : "").slice(0, 100);
    const sort = req.query.sort ? String(req.query.sort).trim() : "latest";
    const contestId = req.query.contestId ? String(req.query.contestId).trim() : "default";
    const skip = (page - 1) * limit;

    res.setHeader("Cache-Control", "public, max-age=3, stale-while-revalidate=10");

    // Deterministic cache key including all query parameters
    const cacheKey = createCacheKey("participants", { page, limit, search: rawSearch, department, sort, contestId });

    const { data: responsePayload, source } = await publicFeedCache.getOrSet(
      cacheKey,
      async () => {
        checkDbAvailable();
        const filter = {};
        if (department) filter.department = department;
        if (rawSearch) {
          const escapedSearch = escapeRegex(rawSearch);
          filter.$or = [
            { name: { $regex: escapedSearch, $options: "i" } },
            { projectName: { $regex: escapedSearch, $options: "i" } },
          ];
        }

        const sortCriteria = sort === "votes" ? { votes: -1, _id: 1 } : { createdAt: -1, _id: 1 };

        const [participants, total] = await Promise.all([
          ParticipantsModel.find(
            filter,
            {
              name: 1,
              department: 1,
              projectName: 1,
              email: 1,
              image: 1,
              description: 1,
              teamNo: 1,
              votes: 1,
              createdAt: 1,
            }
          )
            .sort(sortCriteria)
            .skip(skip)
            .limit(limit)
            .maxTimeMS(10000)
            .lean(),
          rawSearch || department
            ? ParticipantsModel.countDocuments(filter).maxTimeMS(10000)
            : ParticipantsModel.estimatedDocumentCount(),
        ]);

        const formatted = participants.map((p) => ({
          ...p,
          image: resolveImageUrl(req, p.image, p._id),
        }));

        return {
          data: formatted,
          meta: {
            total,
            page,
            limit,
            hasMore: skip + participants.length < total,
          },
        };
      },
      3000 // 3-second TTL
    );

    res.setHeader("X-Cache", source);
    return res.json(responsePayload);
  } catch (err) {
    next(err);
  }
});

// Get participants sorted by votes desc (Leaderboard with rate limiting, projection optimization, stampede-proof TTL cache & max limit 50)
app.get("/allParticipantsByVotes", readLimiter, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 50);
    const contestId = req.query.contestId ? String(req.query.contestId).trim() : "default";
    const skip = (page - 1) * limit;

    res.setHeader("Cache-Control", "public, max-age=3, stale-while-revalidate=10");

    const cacheKey = createCacheKey("leaderboard", { page, limit, contestId });

    const { data: responsePayload, source } = await publicFeedCache.getOrSet(
      cacheKey,
      async () => {
        checkDbAvailable();
        const [participants, total] = await Promise.all([
          ParticipantsModel.find(
            {},
            {
              name: 1,
              department: 1,
              projectName: 1,
              image: 1,
              votes: 1,
            }
          )
            .sort({ votes: -1, _id: 1 })
            .skip(skip)
            .limit(limit)
            .maxTimeMS(10000)
            .lean(),
          ParticipantsModel.estimatedDocumentCount(),
        ]);

        const formatted = participants.map((p) => ({
          ...p,
          image: resolveImageUrl(req, p.image, p._id),
        }));

        return {
          data: formatted,
          meta: {
            total,
            page,
            limit,
            hasMore: skip + participants.length < total,
          },
        };
      },
      3000 // 3-second TTL
    );

    res.setHeader("X-Cache", source);
    return res.json(responsePayload);
  } catch (err) {
    next(err);
  }
});

// Get single participant details by ID (with short-TTL caching & validation)
app.get("/participant/:id", readLimiter, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid participant identifier" });
    }

    res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=15");
    const cacheKey = createCacheKey("participant", { id });

    const { data: participant, source } = await publicFeedCache.getOrSet(
      cacheKey,
      async () => {
        checkDbAvailable();
        const doc = await ParticipantsModel.findById(id).maxTimeMS(10000).lean();
        if (!doc) return null;
        return {
          ...doc,
          image: resolveImageUrl(req, doc.image, doc._id),
        };
      },
      5000 // 5-second TTL
    );

    if (!participant) {
      return res.status(404).json({ error: "Participant not found" });
    }

    res.setHeader("X-Cache", source);
    return res.json(participant);
  } catch (err) {
    next(err);
  }
});

// Vote (Atomic increment + Vote ledger with voter-keyed rate limiting & unique { contestId, voterId } constraint)
app.post("/voteParticipant/:id", authMiddleware, voteLimiter, strictJsonParser, async (req, res, next) => {
  try {
    const participantId = req.params.id;
    const voterId = req.user.id;
    const contestId = req.body && req.body.contestId ? String(req.body.contestId).trim() : "default";

    // 0. Server-side check: Reject with HTTP 403 when voting window is closed
    if (!isVotingEnabledSync() || !(await isVotingEnabled())) {
      return res.status(403).json({
        error: "Voting is currently closed. Please contact an administrator.",
        votingEnabled: false,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(participantId)) {
      return res.status(400).json({ error: "Invalid participant identifier" });
    }

    if (!mongoose.Types.ObjectId.isValid(voterId)) {
      return res.status(400).json({ error: "Invalid voter identifier" });
    }

    checkDbAvailable();

    // 1. Parallel Independent Reads: Fetch participant and duplicate-vote check simultaneously
    const [participant, existingVote] = await Promise.all([
      ParticipantsModel.findById(participantId, { _id: 1, votes: 1 }).maxTimeMS(10000).lean(),
      VoteModel.findOne(
        { contestId, voterId, participantId },
        { _id: 1 }
      ).maxTimeMS(10000).lean(),
    ]);

    if (!participant) {
      return res.status(404).json({ error: "Participant not found" });
    }

    if (existingVote) {
      return res.status(200).json({
        message: "Vote already recorded for this participant",
        votes: participant.votes,
        alreadyVoted: true,
      });
    }

    // 2. Transactional execution for replica sets with two-phase fallback for standalone instances
    const topologyType = mongoose.connection.client?.topology?.description?.type;
    const canUseTransactions = topologyType === "ReplicaSetWithPrimary" || topologyType === "Sharded";

    if (canUseTransactions) {
      const MAX_TRANSACTION_ATTEMPTS = 6; // Bounded to 6 to prevent retry storms
      const MAX_COMMIT_ATTEMPTS = 3;      // Commit retries for UnknownTransactionCommitResult
      const TRANSACTION_TIMEOUT_MS = 6000; // Overall 6-second retry deadline
      const txStartTime = Date.now();

      for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt++) {
        // Guard against client disconnections, shutdown, or retry deadline expiry
        if (
          isShuttingDown ||
          req.timedOut ||
          req.destroyed ||
          res.writableEnded ||
          Date.now() - txStartTime > TRANSACTION_TIMEOUT_MS
        ) {
          return;
        }

        let session = null;
        try {
          // Pre-check cutoff in-process
          if (!isVotingEnabledSync()) {
            return res.status(403).json({
              error: "Voting is currently closed. Please contact an administrator.",
              votingEnabled: false,
            });
          }

          session = await mongoose.startSession();
          session.startTransaction();

          // 1. Insert Vote ledger entry first (compound unique index prevents duplicate votes)
          await VoteModel.create(
            [{ voterId, participantId, contestId }],
            { session }
          );

          // 2. Atomically increment participant vote counter inside the same transaction
          const updated = await ParticipantsModel.findByIdAndUpdate(
            participantId,
            { $inc: { votes: 1 } },
            { new: true, session, select: { votes: 1 }, lean: true }
          );

          // 3. Fast cutoff check before commit
          if (!isVotingEnabledSync()) {
            await session.abortTransaction();
            return res.status(403).json({
              error: "Voting is currently closed. Please contact an administrator.",
              votingEnabled: false,
            });
          }

          // Handle commit with retry on UnknownTransactionCommitResult
          for (let commitAttempt = 1; commitAttempt <= MAX_COMMIT_ATTEMPTS; commitAttempt++) {
            try {
              await session.commitTransaction();
              break; // Commit succeeded
            } catch (commitErr) {
              const isUnknownCommit = Boolean(
                commitErr &&
                ((typeof commitErr.hasErrorLabel === "function" &&
                  commitErr.hasErrorLabel("UnknownTransactionCommitResult")) ||
                  (Array.isArray(commitErr.errorLabels) &&
                    commitErr.errorLabels.includes("UnknownTransactionCommitResult")) ||
                  (commitErr.errorLabelSet &&
                    commitErr.errorLabelSet.has("UnknownTransactionCommitResult")))
              );

              if (isUnknownCommit && commitAttempt < MAX_COMMIT_ATTEMPTS) {
                const commitDelay = Math.min(15 * Math.pow(2, commitAttempt - 1) + Math.random() * 20, 150);
                await new Promise((resolve) => setTimeout(resolve, commitDelay));
                continue;
              }
              throw commitErr;
            }
          }

          // In-memory telemetry update to avoid SettingModel write-lock contention across concurrent transactions
          recordVoteActivity();

          // Invalidate public feed cache on confirmed vote
          publicFeedCache.clear();

          return res.json({
            message: "Vote counted",
            votes: updated ? updated.votes : participant.votes + 1,
          });
        } catch (txErr) {
          if (session) {
            try {
              await session.abortTransaction();
            } catch (_) {}
          }

          // Duplicate-key constraint violation: voter already voted for this participant
          if (txErr.code === 11000) {
            return res.status(409).json({
              error: "You have already voted for this participant",
              alreadyVoted: true,
            });
          }

          // Check for UnknownTransactionCommitResult: never rerun the entire transaction
          const isUnknownCommit = Boolean(
            txErr &&
            ((typeof txErr.hasErrorLabel === "function" &&
              txErr.hasErrorLabel("UnknownTransactionCommitResult")) ||
              (Array.isArray(txErr.errorLabels) &&
                txErr.errorLabels.includes("UnknownTransactionCommitResult")) ||
              (txErr.errorLabelSet &&
                txErr.errorLabelSet.has("UnknownTransactionCommitResult")))
          );

          // Check for transient write conflict or TransientTransactionError
          const isTransient = Boolean(
            txErr &&
            (txErr.code === 112 ||
              txErr.codeName === "WriteConflict" ||
              (txErr.errorResponse &&
                (txErr.errorResponse.code === 112 ||
                  txErr.errorResponse.codeName === "WriteConflict")) ||
              (typeof txErr.message === "string" &&
                txErr.message.includes("Write conflict")) ||
              (typeof txErr.hasErrorLabel === "function" &&
                txErr.hasErrorLabel("TransientTransactionError")) ||
              (Array.isArray(txErr.errorLabels) &&
                txErr.errorLabels.includes("TransientTransactionError")) ||
              (txErr.errorLabelSet &&
                txErr.errorLabelSet.has("TransientTransactionError")))
          );

          if (isTransient && !isUnknownCommit && attempt < MAX_TRANSACTION_ATTEMPTS) {
            // Check deadline budget before sleeping
            if (Date.now() - txStartTime > TRANSACTION_TIMEOUT_MS) {
              throw txErr;
            }

            // Exponential backoff with full jitter to desynchronize concurrent transactions
            const backoffDelay = Math.min(
              20 * Math.pow(1.5, attempt - 1) + Math.floor(Math.random() * 40),
              250
            );
            await new Promise((resolve) => setTimeout(resolve, backoffDelay));
            continue; // Start fresh transaction with a new session on next iteration
          }

          throw txErr;
        } finally {
          if (session) {
            session.endSession();
          }
        }
      }
    } else {
      // Standalone MongoDB (Single): Use unique compound index on Vote model first to guarantee atomicity
      const settingDoc = await SettingModel.findOne({ key: "votingEnabled" }, { value: 1 }).lean();
      if (!settingDoc || !settingDoc.value || !isVotingEnabledSync()) {
        return res.status(403).json({
          error: "Voting is currently closed. Please contact an administrator.",
          votingEnabled: false,
        });
      }

      // In-memory telemetry update to avoid SettingModel write-lock contention
      recordVoteActivity();

      let voteRecord = null;
      try {
        voteRecord = await VoteModel.create({ voterId, participantId, contestId });
      } catch (createErr) {
        if (createErr.code === 11000) {
          return res.status(409).json({
            error: "You have already voted for this participant",
            alreadyVoted: true,
          });
        }
        throw createErr;
      }

      // Check if stopVoting intervened while creating vote record
      if (!isVotingEnabledSync() || !(await isVotingEnabled())) {
        if (voteRecord && voteRecord._id) {
          await VoteModel.findByIdAndDelete(voteRecord._id);
        }
        return res.status(403).json({
          error: "Voting was closed while processing your request.",
          votingEnabled: false,
        });
      }

      // If vote was successfully inserted, atomically increment tally
      try {
        const updated = await ParticipantsModel.findByIdAndUpdate(
          participantId,
          { $inc: { votes: 1 } },
          { new: true, select: { votes: 1 }, lean: true }
        );

        // Final cutoff check before sending successful response
        if (!isVotingEnabledSync() || !(await isVotingEnabled())) {
          if (voteRecord && voteRecord._id) {
            await VoteModel.findByIdAndDelete(voteRecord._id);
          }
          await ParticipantsModel.findByIdAndUpdate(participantId, { $inc: { votes: -1 } });
          return res.status(403).json({
            error: "Voting was closed while processing your request.",
            votingEnabled: false,
          });
        }

        // Invalidate public feed cache on confirmed vote
        publicFeedCache.clear();

        return res.json({ message: "Vote counted", votes: updated ? updated.votes : participant.votes + 1 });
      } catch (incErr) {
        // Compensating rollback if counter increment failed
        if (voteRecord && voteRecord._id) {
          await VoteModel.findByIdAndDelete(voteRecord._id);
        }
        throw incErr;
      }
    }
  } catch (err) {
    next(err);
  }
});

// Get all participant IDs voted by the authenticated user in this contest
app.get("/myVotes", authMiddleware, readLimiter, async (req, res, next) => {
  try {
    const voterId = req.user.id;
    const contestId = req.query.contestId ? String(req.query.contestId).trim() : "default";

    checkDbAvailable();

    const votes = await VoteModel.find(
      { contestId, voterId },
      { participantId: 1 }
    ).maxTimeMS(10000).lean();

    const votedParticipantIds = votes.map((v) => v.participantId.toString());
    res.json({ votedParticipantIds, contestId });
  } catch (err) {
    next(err);
  }
});

// Delete participant (Restricted to authenticated administrators)
app.delete("/deleteParticipant/:id", authMiddleware, adminOnly, adminLimiter, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid participant identifier" });
    }

    checkDbAvailable();

    const deleted = await ParticipantsModel.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Participant not found" });

    // Clean up associated votes and invalidate cache
    await VoteModel.deleteMany({ participantId: id });
    publicFeedCache.clear();

    res.json({ message: "Deleted", data: deleted });
  } catch (err) {
    next(err);
  }
});

// Admin Vote Reconciliation Endpoint (Restricted to administrators)
app.post(
  "/admin/reconcileVotes",
  authMiddleware,
  adminOnly,
  adminLimiter,
  reconcileConcurrency,
  strictJsonParser,
  async (req, res, next) => {
  try {
    checkDbAvailable();
    const contestId = req.body && req.body.contestId ? String(req.body.contestId).trim() : "default";
    const result = await reconcileVotes(contestId);
    publicFeedCache.clear();
    res.json({
      message: "Vote reconciliation completed successfully",
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- ADMIN MANAGEMENT ----------

// Admin Signup (Portal for administrator registration)
app.post(["/admin/signup", "/admin/register"], authLimiter, strictJsonParser, async (req, res, next) => {
  try {
    const { name, email, password, adminKey } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Administrator name is required" });
    }
    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "Administrator email is required" });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Optional environment-configured admin security passcode
    const configuredKey = process.env.ADMIN_SECRET_KEY;
    if (configuredKey && configuredKey.trim()) {
      if (!adminKey || adminKey.trim() !== configuredKey.trim()) {
        return res.status(403).json({ error: "Invalid Administrator Security Passcode" });
      }
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: "Invalid email address format" });
    }

    checkDbAvailable();

    const exists = await User.findOne(
      { email: normalizedEmail },
      { name: 1, email: 1, password: 1, role: 1 }
    );
    if (exists) {
      if (exists.role === "admin") {
        return res.status(400).json({ error: "This email is already registered as an administrator. Please log in." });
      }
      // If user exists as student, upgrade to admin
      exists.role = "admin";
      exists.name = name.trim();
      exists.password = password;
      await exists.save();

      const secret = getJwtSecret();
      const token = jwt.sign(
        { id: exists._id, email: exists.email, role: exists.role },
        secret,
        { expiresIn: "7d" }
      );

      return res.status(200).json({
        message: "Account upgraded to Administrator successfully",
        token,
        user: { id: exists._id, name: exists.name, email: exists.email, role: exists.role },
      });
    }

    const newAdmin = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: "admin",
    });

    const secret = getJwtSecret();
    const token = jwt.sign(
      { id: newAdmin._id, email: newAdmin.email, role: newAdmin.role },
      secret,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "Administrator account created successfully",
      token,
      user: { id: newAdmin._id, name: newAdmin.name, email: newAdmin.email, role: newAdmin.role },
    });
  } catch (err) {
    next(err);
  }
});

// Register a new Admin (Restricted to authenticated administrators only)
app.post(
  ["/admin/registerAdmin", "/admin/createAdmin"],
  authMiddleware,
  adminOnly,
  adminLimiter,
  strictJsonParser,
  async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Administrator name is required" });
    }
    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "Administrator email is required" });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: "Invalid email address format" });
    }

    checkDbAvailable();

    const exists = await User.findOne(
      { email: normalizedEmail },
      { name: 1, email: 1, password: 1, role: 1 }
    );
    if (exists) {
      if (exists.role === "admin") {
        return res.status(400).json({ error: "This email is already registered as an administrator" });
      }
      // If user exists as student, promote to admin and update password
      exists.role = "admin";
      exists.name = name.trim();
      exists.password = password;
      await exists.save();
      return res.status(200).json({
        message: `Existing user [${normalizedEmail}] promoted to Administrator`,
        admin: { id: exists._id, name: exists.name, email: exists.email, role: exists.role },
      });
    }

    const newAdmin = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: "admin",
    });

    res.status(201).json({
      message: "New Administrator created successfully",
      admin: { id: newAdmin._id, name: newAdmin.name, email: newAdmin.email, role: newAdmin.role },
    });
  } catch (err) {
    next(err);
  }
});

// List all Administrators (Restricted to authenticated administrators only)
app.get(["/admin/listAdmins", "/admin/admins"], authMiddleware, adminOnly, adminLimiter, async (req, res, next) => {
  try {
    checkDbAvailable();
    const admins = await User.find(
      { role: "admin" },
      { name: 1, email: 1, role: 1, createdAt: 1 }
    )
      .sort({ createdAt: -1 })
      .maxTimeMS(10000)
      .lean();

    res.json({
      data: admins,
      total: admins.length,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- ADMIN VOTING WINDOW CONTROLS ----------

// Get current voting status (Admin only)
app.get(["/admin/votingStatus", "/admin/voting-status"], authMiddleware, adminOnly, adminLimiter, async (req, res, next) => {
  try {
    checkDbAvailable();
    const enabled = await isVotingEnabled();
    return res.json({
      votingEnabled: enabled,
      message: enabled ? "Voting is currently open" : "Voting is currently closed",
    });
  } catch (err) {
    next(err);
  }
});

// Start voting window (Admin only)
app.post(["/admin/startVoting", "/admin/start-voting"], authMiddleware, adminOnly, adminLimiter, async (req, res, next) => {
  try {
    checkDbAvailable();
    const enabled = await setVotingEnabled(true);
    publicFeedCache.clear();
    return res.json({
      message: "Voting has been started successfully",
      votingEnabled: enabled,
    });
  } catch (err) {
    next(err);
  }
});

// Stop voting window (Admin only)
app.post(["/admin/stopVoting", "/admin/stop-voting"], authMiddleware, adminOnly, adminLimiter, async (req, res, next) => {
  try {
    checkDbAvailable();
    const enabled = await setVotingEnabled(false);
    publicFeedCache.clear();
    return res.json({
      message: "Voting has been stopped successfully",
      votingEnabled: enabled,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- HEALTH & MONITORING ENDPOINTS ----------

// Health Check: Lightweight, fast, non-blocking, and free of sensitive information/secrets
app.get("/health", (req, res) => {
  const dbHealth = getDbHealth();
  const uptimeSeconds = Math.floor(process.uptime());
  const now = new Date().toISOString();

  if (isShuttingDown) {
    return res.status(503).json({
      status: "SHUTTING_DOWN",
      database: dbHealth.state,
      time: now,
      uptimeSeconds,
    });
  }

  const isHealthy = dbHealth.isConnected;
  const statusCode = isHealthy ? 200 : 503;

  const responsePayload = {
    status: isHealthy ? "OK" : "DEGRADED",
    database: dbHealth.state,
    time: now,
    uptimeSeconds,
  };

  // If detailed diagnostic is requested, include sanitized non-secret operational telemetry
  if (req.query.detail === "true" || req.query.telemetry === "true") {
    const configuredMaxPool = parseInt(process.env.MONGO_MAX_POOL_SIZE, 10) || 25;
    const metrics = dbMetrics.getMetrics(configuredMaxPool);
    responsePayload.telemetry = {
      lastVoteActivityAt: getLastVoteActivity(),
      cache: publicFeedCache.getMetrics(),
      pool: metrics.pool,
      operations: metrics.operations,
      latency: metrics.latency,
      resources: metrics.resources,
    };
  }

  res.status(statusCode).json(responsePayload);
});

// Admin Database Telemetry Diagnostic Endpoint (Restricted to administrators)
app.get("/admin/db-metrics", authMiddleware, adminOnly, adminLimiter, (req, res) => {
  const configuredMaxPool = parseInt(process.env.MONGO_MAX_POOL_SIZE, 10) || 25;
  res.json(dbMetrics.getMetrics(configuredMaxPool));
});

// Root welcome banner
app.get("/", (req, res) => res.send("🚀 Rating API Running"));

// ---------- 404 & Centralized Error Handlers ----------
app.use(notFoundHandler);
app.use(errorHandler);

// ---------- Lifecycle & Graceful Shutdown Management ----------
const SHUTDOWN_GRACE_PERIOD_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 15000;

async function gracefulShutdown(signal, exitCode = 0) {
  if (isShuttingDown) {
    logger.warn({ signal }, "Shutdown already in progress");
    return;
  }
  isShuttingDown = true;

  logger.info(
    { signal, activeRequests, gracePeriodMs: SHUTDOWN_GRACE_PERIOD_MS },
    `Starting graceful shutdown [${signal}]. Stopping incoming requests...`
  );

  // Set bounded timer to force exit if requests or DB hang
  const forceTimer = setTimeout(() => {
    logger.error(
      { activeRequests },
      `Forced shutdown: Timed out after ${SHUTDOWN_GRACE_PERIOD_MS}ms. Exiting immediately.`
    );
    if (server && server.closeAllConnections) {
      server.closeAllConnections();
    }
    process.exit(exitCode !== 0 ? exitCode : 1);
  }, SHUTDOWN_GRACE_PERIOD_MS);

  if (forceTimer.unref) forceTimer.unref();

  // 1. Stop HTTP server from accepting new socket connections
  if (server) {
    server.close((err) => {
      if (err) {
        logger.error({ err: { message: err.message } }, "Error closing HTTP server");
      } else {
        logger.info("HTTP server closed successfully");
      }
    });

    // Close idle keep-alive connections immediately
    if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }
  }

  // 2. Wait for in-flight requests to finish within the grace period
  if (activeRequests > 0) {
    logger.info({ activeRequests }, "Waiting for in-flight requests to complete...");
    await new Promise((resolve) => {
      drainResolve = resolve;
      // Safety interval in case of missed event
      const checkInterval = setInterval(() => {
        if (activeRequests <= 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      if (checkInterval.unref) checkInterval.unref();
    });
    logger.info("All in-flight requests completed successfully");
  }

  // 3. Close MongoDB connection
  try {
    await closeDB(false, 5000);
    logger.info("MongoDB connection closed cleanly");
  } catch (dbErr) {
    logger.error({ err: { message: dbErr.message } }, "Error closing MongoDB connection");
  }

  clearTimeout(forceTimer);
  logger.info({ exitCode }, "Graceful shutdown complete. Process exiting.");
  process.exit(exitCode);
}

// OS Process Signal Listeners
process.on("SIGTERM", () => gracefulShutdown("SIGTERM", 0));
process.on("SIGINT", () => gracefulShutdown("SIGINT", 0));

// Process Crash Protections: Do not continue running in potentially corrupted state
process.on("uncaughtException", (err) => {
  logger.fatal(
    {
      err: {
        message: err.message,
        name: err.name,
        stack: err.stack,
      },
    },
    "CRITICAL: Uncaught exception encountered. Initiating controlled shutdown."
  );
  gracefulShutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal(
    {
      reason:
        reason instanceof Error
          ? { message: reason.message, name: reason.name, stack: reason.stack }
          : reason,
    },
    "CRITICAL: Unhandled promise rejection encountered. Initiating controlled shutdown."
  );
  gracefulShutdown("unhandledRejection", 1);
});

// ---------- Server Start (Skipped in Test Environment) ----------
if (process.env.NODE_ENV !== "test") {
  try {
    getJwtSecret();
  } catch (e) {
    logger.fatal({ err: { message: e.message } }, "Configuration Error");
    process.exit(1);
  }

  server = app.listen(PORT, "0.0.0.0", () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV || "development" }, `🚀 ExpoVote API listening on port ${PORT}`);
  });

  // Tune server socket keep-alive timeouts for Render/Cloudflare reverse proxies
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 30000;

  // Initialize and connect MongoDB singleton
  connectDB(effectiveMongoUrl).catch((err) => {
    logger.error({ err: { message: err.message } }, "Initial MongoDB connection attempt failed");
  });
}

// Attach helpers for testing and external access
app.gracefulShutdown = gracefulShutdown;
app.getActiveRequests = () => activeRequests;
app.isShuttingDown = () => isShuttingDown;
app.getServer = () => server;

module.exports = app;
