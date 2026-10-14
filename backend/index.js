// server.js
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const { ParticipantsModel } = require("./models/participantsModels");
const User = require("./models/userModel");
const VoteModel = require("./models/voteModel");
const SettingModel = require("./models/settingModel");
const { authMiddleware, adminOnly, getJwtSecret } = require("./middleware/auth");
const { handleUpload, cloudinary } = require("./middleware/upload");
const { reconcileVotes, isVotingEnabled, isVotingEnabledSync, setVotingEnabled } = require("./services/voteService");
const { authLimiter, uploadLimiter, voteLimiter, readLimiter } = require("./middleware/rateLimiter");

const PORT = parseInt(process.env.PORT) || 5000;
const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL && process.env.NODE_ENV === "production") {
  console.error("FATAL: MONGO_URL environment variable is required in production.");
  process.exit(1);
}

const effectiveMongoUrl = MONGO_URL || "mongodb://127.0.0.1:27017/ratingdb";

const app = express();

// Trust Render's single upstream reverse proxy hop (Cloudflare / Render load balancer)
app.set("trust proxy", 1);

app.use(express.json());

// Serve static uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// CORS configuration
const allowedOrigin = process.env.FRONTEND_URL || "*";
app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: allowedOrigin !== "*",
  })
);

// Request logger for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

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

  // External URL
  return rawImage;
}

// ---------- IMAGE STREAMING / CACHING ENDPOINT ----------
app.get("/participantImage/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect("https://via.placeholder.com/300");
    }

    const participant = await ParticipantsModel.findById(id, { image: 1 });
    if (!participant || !participant.image) {
      return res.redirect("https://via.placeholder.com/300");
    }

    if (participant.image.startsWith("data:image/")) {
      const matches = participant.image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (matches) {
        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        res.setHeader("Content-Type", mimeType);
        res.setHeader("Cache-Control", "public, max-age=86400"); // 24-hour browser cache
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
app.post("/signup", authLimiter, async (req, res) => {
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

    const exists = await User.findOne({ email: normalizedEmail });
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
    console.error("Signup Error:", err);
    res.status(500).json({ error: "Server error during registration" });
  }
});

// Login
app.post("/login", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email & password required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    console.log("Login attempt for:", normalizedEmail);
    const ok = await user.comparePassword(password);
    console.log("Password matched:", ok);
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
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ---------- PARTICIPANT ROUTES ----------

// Add Participant (with rate limiting, JWT authentication, disk upload protection & 2MB max limit)
app.post("/addParticipants", uploadLimiter, authMiddleware, handleUpload, async (req, res) => {
  try {
    const { name, department, projectName, email, description, teamNo } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      if (req.file && (req.file.filename || req.file.public_id)) {
        try {
          await cloudinary.uploader.destroy(req.file.filename || req.file.public_id);
        } catch (_) {}
      }
      return res.status(400).json({ error: "name is required" });
    }

    // Reconcile department and projectName for backward compatibility
    const resolvedDept = (department || projectName || "").trim();
    const resolvedProject = (projectName || department || "").trim();

    let image = "https://via.placeholder.com/300";
    if (req.file) {
      image = req.file.path || req.file.secure_url || req.file.url || "https://via.placeholder.com/300";
    } else if (req.body.image && typeof req.body.image === "string") {
      image = req.body.image.trim();
    }

    const participant = await ParticipantsModel.create({
      name: name.trim(),
      department: resolvedDept,
      projectName: resolvedProject,
      email: email ? String(email).trim() : undefined,
      description: description ? String(description).trim() : "",
      teamNo: teamNo ? Number(teamNo) : undefined,
      image,
    });

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
    console.error("Add Participant Error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// Get all participants (with rate limiting, server-enforced pagination max limit 50 & lightweight image URLs)
app.get("/allParticipants", readLimiter, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 6, 1), 50);
    const skip = (page - 1) * limit;

    const participants = await ParticipantsModel.find(
      {},
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
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formatted = participants.map((p) => ({
      ...p,
      image: resolveImageUrl(req, p.image, p._id),
    }));

    const total = await ParticipantsModel.countDocuments();

    res.json({
      data: formatted,
      meta: {
        total,
        page,
        limit,
        hasMore: skip + participants.length < total,
      },
    });
  } catch (err) {
    console.error("Fetch Participants Error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// Get participants sorted by votes desc (Leaderboard with rate limiting, projection optimization & max limit 50)
app.get("/allParticipantsByVotes", readLimiter, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 6, 1), 50);
    const skip = (page - 1) * limit;

    // Leaderboard query: project only fields needed for rankings
    const participants = await ParticipantsModel.find(
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
      .lean();

    const formatted = participants.map((p) => ({
      ...p,
      image: resolveImageUrl(req, p.image, p._id),
    }));

    const total = await ParticipantsModel.countDocuments();

    res.json({
      data: formatted,
      meta: {
        total,
        page,
        limit,
        hasMore: skip + participants.length < total,
      },
    });
  } catch (err) {
    console.error("Fetch By Votes Error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// Vote (Atomic increment + Vote ledger with voter-keyed rate limiting & unique { contestId, voterId } constraint)
app.post("/voteParticipant/:id", authMiddleware, voteLimiter, async (req, res) => {
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

    const participant = await ParticipantsModel.findById(participantId);
    if (!participant) {
      return res.status(404).json({ error: "Participant not found" });
    }

    // 1. Idempotency & Duplicate Check
    const existingVote = await VoteModel.findOne({ contestId, voterId });
    if (existingVote) {
      // Safe retry: if voter already voted for this same participant in this contest
      if (existingVote.participantId.toString() === participantId.toString()) {
        return res.status(200).json({
          message: "Vote already recorded for this participant",
          votes: participant.votes,
          alreadyVoted: true,
        });
      }
      // Voted for another participant in the same contest
      return res.status(409).json({
        error: "You have already cast your vote in this contest",
      });
    }

    // 2. Transactional execution for replica sets with two-phase fallback for standalone instances
    const topologyType = mongoose.connection.client?.topology?.description?.type;
    const canUseTransactions = topologyType === "ReplicaSetWithPrimary" || topologyType === "Sharded";

    if (canUseTransactions) {
      const MAX_TRANSACTION_ATTEMPTS = 5;
      const MAX_COMMIT_ATTEMPTS = 5;

      for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt++) {
        let session = null;
        try {
          session = await mongoose.startSession();
          session.startTransaction();

          // Serialization check inside transaction:
          // Atomically update setting document with { value: true }.
          // This acquires a write lock in MongoDB, serializing against concurrent stopVoting writes!
          const activeInTx = await SettingModel.findOneAndUpdate(
            { key: "votingEnabled", value: true },
            { $set: { lastVoteActivityAt: new Date() } },
            { session, new: true }
          );

          if (!activeInTx || !isVotingEnabledSync()) {
            await session.abortTransaction();
            return res.status(403).json({
              error: "Voting is currently closed. Please contact an administrator.",
              votingEnabled: false,
            });
          }

          await VoteModel.create(
            [{ voterId, participantId, contestId }],
            { session }
          );

          const updated = await ParticipantsModel.findByIdAndUpdate(
            participantId,
            { $inc: { votes: 1 } },
            { new: true, session }
          );

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
                const commitDelay = Math.min(20 * Math.pow(2, commitAttempt - 1) + Math.random() * 25, 200);
                await new Promise((resolve) => setTimeout(resolve, commitDelay));
                continue;
              }
              throw commitErr;
            }
          }

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

          // Duplicate-key constraint violation: DO NOT RETRY, return HTTP 409 immediately
          if (txErr.code === 11000) {
            return res.status(409).json({
              error: "You have already cast your vote in this contest",
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
                (typeof txErr.hasErrorLabel === "function" &&
                  txErr.hasErrorLabel("TransientTransactionError")) ||
                (Array.isArray(txErr.errorLabels) &&
                  txErr.errorLabels.includes("TransientTransactionError")) ||
                (txErr.errorLabelSet &&
                  txErr.errorLabelSet.has("TransientTransactionError")))
          );

          if (isTransient && !isUnknownCommit && attempt < MAX_TRANSACTION_ATTEMPTS) {
            // Exponential backoff with randomized jitter
            const backoffDelay = Math.min(
              25 * attempt + Math.floor(Math.random() * (250 * attempt)),
              1200
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
      const activeSetting = await SettingModel.findOneAndUpdate(
        { key: "votingEnabled", value: true },
        { $set: { lastVoteActivityAt: new Date() } },
        { new: true }
      );
      if (!activeSetting || !isVotingEnabledSync()) {
        return res.status(403).json({
          error: "Voting is currently closed. Please contact an administrator.",
          votingEnabled: false,
        });
      }

      let voteRecord = null;
      try {
        voteRecord = await VoteModel.create({ voterId, participantId, contestId });
      } catch (createErr) {
        if (createErr.code === 11000) {
          return res.status(409).json({ error: "You have already cast your vote in this contest" });
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
          { new: true }
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
    console.error("Vote Error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// Delete participant (Restricted to authenticated administrators)
app.delete("/deleteParticipant/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid participant identifier" });
    }

    const deleted = await ParticipantsModel.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "Participant not found" });

    // Clean up associated votes
    await VoteModel.deleteMany({ participantId: id });

    res.json({ message: "Deleted", data: deleted });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// Admin Vote Reconciliation Endpoint (Restricted to administrators)
app.post("/admin/reconcileVotes", authMiddleware, adminOnly, async (req, res) => {
  try {
    const contestId = req.body && req.body.contestId ? String(req.body.contestId).trim() : "default";
    const result = await reconcileVotes(contestId);
    res.json({
      message: "Vote reconciliation completed successfully",
      ...result,
    });
  } catch (err) {
    console.error("Reconciliation Error:", err);
    res.status(500).json({ error: err.message || "Server error during reconciliation" });
  }
});

// ---------- ADMIN VOTING WINDOW CONTROLS ----------

// Get current voting status (Admin only)
app.get(["/admin/votingStatus", "/admin/voting-status"], authMiddleware, adminOnly, async (req, res) => {
  try {
    const enabled = await isVotingEnabled();
    return res.json({
      votingEnabled: enabled,
      message: enabled ? "Voting is currently open" : "Voting is currently closed",
    });
  } catch (err) {
    console.error("Error retrieving voting status:", err);
    return res.status(500).json({ error: "Failed to retrieve voting status" });
  }
});

// Start voting window (Admin only)
app.post(["/admin/startVoting", "/admin/start-voting"], authMiddleware, adminOnly, async (req, res) => {
  try {
    const enabled = await setVotingEnabled(true);
    return res.json({
      message: "Voting has been started successfully",
      votingEnabled: enabled,
    });
  } catch (err) {
    console.error("Error starting voting:", err);
    return res.status(500).json({ error: "Failed to start voting" });
  }
});

// Stop voting window (Admin only)
app.post(["/admin/stopVoting", "/admin/stop-voting"], authMiddleware, adminOnly, async (req, res) => {
  try {
    const enabled = await setVotingEnabled(false);
    return res.json({
      message: "Voting has been stopped successfully",
      votingEnabled: enabled,
    });
  } catch (err) {
    console.error("Error stopping voting:", err);
    return res.status(500).json({ error: "Failed to stop voting" });
  }
});

// Health check with live DB status
app.get("/health", (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? "Connected" : "Disconnected";
  res.json({
    status: "OK",
    database: dbStatus,
    time: new Date().toISOString(),
  });
});

// Root
app.get("/", (req, res) => res.send("🚀 Rating API Running"));

// ---------- DB connect & start ----------
mongoose.set("strictQuery", false);

if (process.env.NODE_ENV !== "test") {
  // Ensure JWT_SECRET is configured before starting
  try {
    getJwtSecret();
  } catch (e) {
    console.error("Configuration Error:", e.message);
    process.exit(1);
  }

  const mongooseOptions = {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 50,
    minPoolSize: 5,
    socketTimeoutMS: 45000,
  };

  mongoose
    .connect(effectiveMongoUrl, mongooseOptions)
    .then(() => {
      console.log("✅ MongoDB connected successfully to:", effectiveMongoUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"));
      app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running on port ${PORT}`));
    })
    .catch((err) => {
      console.error("❌ MongoDB connection error:", err);
      process.exit(1);
    });
}

module.exports = app;
