const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const app = require("../index");
const User = require("../models/userModel");
const { ParticipantsModel } = require("../models/participantsModels");
const VoteModel = require("../models/voteModel");
const { getJwtSecret } = require("../middleware/auth");
const { reconcileVotes } = require("../services/voteService");
const { cloudinary } = require("../middleware/upload");

const TEST_MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/ratingdb_test";

jest.setTimeout(25000);

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  }
  // Ensure schema indexes are built in test database
  await ParticipantsModel.init();
  await VoteModel.init();
  await User.init();
});

beforeEach(async () => {
  await User.deleteMany({});
  await ParticipantsModel.deleteMany({});
  await VoteModel.deleteMany({});
});

afterAll(async () => {
  await User.deleteMany({});
  await ParticipantsModel.deleteMany({});
  await VoteModel.deleteMany({});
  await mongoose.connection.close();
});

describe("PART B.1: Image Upload Protection & Storage", () => {
  test("Rejects upload exceeding 2 MB with HTTP 400", async () => {
    // Generate a 2.5 MB dummy buffer
    const largeBuffer = Buffer.alloc(2.5 * 1024 * 1024, "a");

    const res = await request(app)
      .post("/addParticipants")
      .field("name", "Oversized Project")
      .field("department", "CSE")
      .attach("image", largeBuffer, { filename: "large_image.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2MB/i);
  }, 30000);

  test("Rejects invalid file types (e.g. text or pdf) with HTTP 400", async () => {
    const invalidBuffer = Buffer.from("console.log('malicious script');");

    const res = await request(app)
      .post("/addParticipants")
      .field("name", "Invalid File Project")
      .attach("image", invalidBuffer, { filename: "script.js", contentType: "application/javascript" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only JPEG, PNG, WEBP, and GIF images are allowed/i);
  });

  test("Real Cloudinary Integration: Accepts valid image under 2 MB, stores Cloudinary HTTPS URL in DB, and verifies live CDN retrieval", async () => {
    // Create a tiny valid 1x1 PNG buffer
    const validPngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );

    const res = await request(app)
      .post("/addParticipants")
      .field("name", "Valid Image Project")
      .field("department", "Robotics")
      .attach("image", validPngBuffer, { filename: "test.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();

    // Verify stored participant in DB has a Cloudinary HTTPS URL, NOT a local path or Base64 string
    const participant = await ParticipantsModel.findById(res.body.data._id);
    expect(participant.image).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(participant.image).toContain("expovote/participants");

    // Verify image retrieval from Cloudinary via HTTPS GET
    const axios = require("axios");
    const imageFetch = await axios.get(participant.image, { responseType: "arraybuffer" });
    expect(imageFetch.status).toBe(200);
    expect(imageFetch.headers["content-type"]).toMatch(/image\/(png|jpeg)/);
    expect(imageFetch.data.length).toBeGreaterThan(0);

    // Clean up test asset from Cloudinary
    const match = participant.image.match(/expovote\/participants\/[^.]+/);
    if (match) {
      await cloudinary.uploader.destroy(match[0]);
    }
  }, 30000);

  test("Mocked: Database failure triggers orphan cleanup and destroys uploaded Cloudinary asset", async () => {
    const destroySpy = jest.spyOn(cloudinary.uploader, "destroy");
    const createSpy = jest.spyOn(ParticipantsModel, "create").mockRejectedValueOnce(
      new Error("Database connection dropped during insert")
    );

    const validPngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );

    try {
      const res = await request(app)
        .post("/addParticipants")
        .field("name", "Failed DB Participant")
        .field("department", "CSE")
        .attach("image", validPngBuffer, { filename: "cleanup_test.png", contentType: "image/png" });

      expect(res.status).toBe(500);
      expect(destroySpy).toHaveBeenCalled();
      const calledWith = destroySpy.mock.calls[0][0];
      expect(calledWith).toMatch(/expovote\/participants\//);
    } finally {
      createSpy.mockRestore();
      destroySpy.mockRestore();
    }
  });

  test("Allows participant creation without image and defaults to placeholder", async () => {
    const res = await request(app)
      .post("/addParticipants")
      .field("name", "No Image Participant")
      .field("department", "Mechanical");

    expect(res.status).toBe(201);
    expect(res.body.data.image).toBe("https://via.placeholder.com/300");

    const inDb = await ParticipantsModel.findById(res.body.data._id);
    expect(inDb.image).toBe("https://via.placeholder.com/300");
  });

  test("Allows participant creation with external HTTPS image URL without re-uploading", async () => {
    const externalUrl = "https://images.unsplash.com/photo-1518770660439-4636190af475";
    const res = await request(app)
      .post("/addParticipants")
      .field("name", "External Image Participant")
      .field("department", "ECE")
      .field("image", externalUrl);

    expect(res.status).toBe(201);
    expect(res.body.data.image).toBe(externalUrl);

    const inDb = await ParticipantsModel.findById(res.body.data._id);
    expect(inDb.image).toBe(externalUrl);
  });
});

describe("PART B.2 & B.4: API Response Size & Pagination Clamping", () => {
  beforeEach(async () => {
    // Seed 15 participants
    const docs = [];
    for (let i = 1; i <= 15; i++) {
      docs.push({
        name: `Team ${i}`,
        department: `Dept ${i}`,
        projectName: `Project ${i}`,
        votes: i,
        // Legacy Base64 string simulation
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      });
    }
    await ParticipantsModel.insertMany(docs);
  });

  test("GET /allParticipants clamps excessive limit parameter to maximum 50", async () => {
    const res = await request(app).get("/allParticipants?page=1&limit=1000");
    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(50);
  });

  test("GET /allParticipants converts legacy Base64 strings to lightweight streaming URLs", async () => {
    const res = await request(app).get("/allParticipants?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);

    // None of the returned items should contain a raw data:image Base64 string
    res.body.data.forEach((p) => {
      expect(p.image).toMatch(/\/participantImage\//);
      expect(p.image).not.toMatch(/^data:image/);
    });
  });

  test("GET /participantImage/:id streams the image with HTTP cache headers", async () => {
    const participant = await ParticipantsModel.findOne({});
    const res = await request(app).get(`/participantImage/${participant._id}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toMatch(/public, max-age=86400/);
  });

  test("GET /allParticipantsByVotes omits unneeded heavy fields from leaderboard", async () => {
    const res = await request(app).get("/allParticipantsByVotes?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);

    res.body.data.forEach((p) => {
      expect(p.name).toBeDefined();
      expect(p.votes).toBeDefined();
      expect(p.image).toBeDefined();
      // Description and email must NOT be projected in leaderboard responses
      expect(p.description).toBeUndefined();
      expect(p.email).toBeUndefined();
    });
  });
});

describe("PART B.2: Database Indexes Verification", () => {
  test("Participants collection has required compound and secondary indexes", async () => {
    const indexes = await ParticipantsModel.collection.indexes();
    const indexNames = indexes.map((idx) => Object.keys(idx.key).join("_"));

    // Verify index on votes desc, _id asc
    const hasVotesIndex = indexes.some(
      (idx) => idx.key.votes === -1 && idx.key._id === 1
    );
    expect(hasVotesIndex).toBe(true);

    // Verify index on createdAt desc, _id asc
    const hasCreatedAtIndex = indexes.some(
      (idx) => idx.key.createdAt === -1 && idx.key._id === 1
    );
    expect(hasCreatedAtIndex).toBe(true);
  });

  test("Votes collection has unique compound index on { contestId, voterId }", async () => {
    const indexes = await VoteModel.collection.indexes();
    const compoundVoteIdx = indexes.find(
      (idx) => idx.key.contestId === 1 && idx.key.voterId === 1
    );

    expect(compoundVoteIdx).toBeDefined();
    expect(compoundVoteIdx.unique).toBe(true);
  });
});

describe("PART A.1: Vote Crash Recovery & Reconciliation", () => {
  let adminToken;
  let studentToken;
  let participant;

  beforeEach(async () => {
    const admin = await User.create({
      name: "Admin",
      email: "admin_reconcile@test.com",
      password: "password123",
      role: "admin",
    });
    adminToken = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      getJwtSecret()
    );

    const student = await User.create({
      name: "Student",
      email: "student_reconcile@test.com",
      password: "password123",
      role: "student",
    });
    studentToken = jwt.sign(
      { id: student._id, email: student.email, role: student.role },
      getJwtSecret()
    );

    participant = await ParticipantsModel.create({
      name: "Team Crash Test",
      department: "CSE",
      votes: 0,
      legacyVotes: 2, // 2 base legacy votes before ledger
    });
  });

  test("Reconciliation repairs undercounted votes after simulated crash between Vote insert and counter increment", async () => {
    // Simulate 3 verified votes in Vote ledger
    const voterIds = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
    ];

    for (const vId of voterIds) {
      await VoteModel.create({
        voterId: vId,
        participantId: participant._id,
        contestId: "default",
      });
    }

    // In a crash scenario, participant.votes was left at 0 (or only partial)
    expect(participant.votes).toBe(0);

    // Run reconciliation service
    const report = await reconcileVotes("default");
    expect(report.reconciledParticipants).toBe(1);
    expect(report.totalLedgerVotes).toBe(3);

    // Expected tally: legacyVotes (2) + ledgerVotes (3) = 5
    const updated = await ParticipantsModel.findById(participant._id);
    expect(updated.votes).toBe(5);
  });

  test("POST /admin/reconcileVotes rejects non-admin users with 403", async () => {
    const res = await request(app)
      .post("/admin/reconcileVotes")
      .set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(403);
  });

  test("POST /admin/reconcileVotes executes successfully for authorized administrator", async () => {
    const res = await request(app)
      .post("/admin/reconcileVotes")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ contestId: "default" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Vote reconciliation completed/i);
  });
});

describe("PART B.3: Environment Configuration Failure Safety", () => {
  test("getJwtSecret throws fatal error in production when JWT_SECRET is unset", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;

    try {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;

      expect(() => getJwtSecret()).toThrow(/JWT_SECRET environment variable is missing in production/i);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.JWT_SECRET = originalSecret;
    }
  });
});
