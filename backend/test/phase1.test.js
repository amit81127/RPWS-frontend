const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = require("../index");
const User = require("../models/userModel");
const { ParticipantsModel } = require("../models/participantsModels");
const VoteModel = require("../models/voteModel");
const { getJwtSecret } = require("../middleware/auth");

const TEST_MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/ratingdb_test";

jest.setTimeout(25000);

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  }
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

describe("TASK 1: Authentication & Password Single-Hashing", () => {
  test("Password hashing occurs exactly once on signup", async () => {
    const rawPassword = "password123";
    const res = await request(app)
      .post("/signup")
      .send({ name: "Student One", email: "student1@example.com", password: rawPassword });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();

    const user = await User.findOne({ email: "student1@example.com" });
    expect(user).toBeTruthy();
    // Password must be hashed (not plaintext)
    expect(user.password).not.toBe(rawPassword);
    // Password verification must succeed with single compare
    const matches = await bcrypt.compare(rawPassword, user.password);
    expect(matches).toBe(true);
  });

  test("Valid credentials can authenticate via login", async () => {
    await request(app)
      .post("/signup")
      .send({ name: "Student Two", email: "student2@example.com", password: "securepassword" });

    const loginRes = await request(app)
      .post("/login")
      .send({ email: "student2@example.com", password: "securepassword" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.user).toBeDefined();
    expect(loginRes.body.user.email).toBe("student2@example.com");
    // Must never return password hash in response
    expect(loginRes.body.user.password).toBeUndefined();
  });

  test("Invalid credentials are rejected with 401", async () => {
    await request(app)
      .post("/signup")
      .send({ name: "Student Three", email: "student3@example.com", password: "correctpass" });

    const loginRes = await request(app)
      .post("/login")
      .send({ email: "student3@example.com", password: "wrongpassword" });

    expect(loginRes.status).toBe(401);
    expect(loginRes.body.error).toBe("Invalid credentials");
  });

  test("Signup ignores client-provided admin role and defaults to student", async () => {
    const res = await request(app)
      .post("/signup")
      .send({
        name: "Hacker Attempt",
        email: "hacker@example.com",
        password: "secretpassword",
        role: "admin", // Malicious attempt to self-assign admin
      });

    expect(res.status).toBe(201);
    const user = await User.findOne({ email: "hacker@example.com" });
    expect(user.role).toBe("student");
  });

  test("Missing credentials return 400", async () => {
    const res = await request(app)
      .post("/signup")
      .send({ email: "missing@example.com" }); // missing name and password

    expect(res.status).toBe(400);
  });
});

describe("TASK 2: Secure Administrative Operations & RBAC", () => {
  let studentToken;
  let adminToken;
  let participantId;

  beforeEach(async () => {
    // Create student
    const student = await User.create({
      name: "Normal Student",
      email: "student@test.com",
      password: "password123",
      role: "student",
    });
    studentToken = jwt.sign(
      { id: student._id, email: student.email, role: student.role },
      getJwtSecret()
    );

    // Create admin
    const admin = await User.create({
      name: "System Admin",
      email: "admin@test.com",
      password: "password123",
      role: "admin",
    });
    adminToken = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      getJwtSecret()
    );

    // Create participant
    const participant = await ParticipantsModel.create({
      name: "Robotics Club",
      department: "CSE",
      projectName: "AI Rover",
      votes: 5,
    });
    participantId = participant._id.toString();
  });

  test("Unauthenticated deletion request is rejected with 401", async () => {
    const res = await request(app).delete(`/deleteParticipant/${participantId}`);
    expect(res.status).toBe(401);
  });

  test("Ordinary student user deletion request is rejected with 403 Forbidden", async () => {
    const res = await request(app)
      .delete(`/deleteParticipant/${participantId}`)
      .set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Administrator privileges required/i);

    // Verify record was not deleted
    const check = await ParticipantsModel.findById(participantId);
    expect(check).toBeTruthy();
  });

  test("Authorized administrator can perform deletion", async () => {
    const res = await request(app)
      .delete(`/deleteParticipant/${participantId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Deleted");

    const check = await ParticipantsModel.findById(participantId);
    expect(check).toBeNull();
  });
});

describe("TASK 3: Repair Voting Data Integrity", () => {
  let voter1Token;
  let voter2Token;
  let voter1Id;
  let voter2Id;
  let participant1Id;
  let participant2Id;

  beforeEach(async () => {
    const voter1 = await User.create({
      name: "Voter One",
      email: "voter1@test.com",
      password: "password123",
      role: "student",
    });
    voter1Id = voter1._id.toString();
    voter1Token = jwt.sign({ id: voter1Id, role: "student" }, getJwtSecret());

    const voter2 = await User.create({
      name: "Voter Two",
      email: "voter2@test.com",
      password: "password123",
      role: "student",
    });
    voter2Id = voter2._id.toString();
    voter2Token = jwt.sign({ id: voter2Id, role: "student" }, getJwtSecret());

    const p1 = await ParticipantsModel.create({
      name: "Team Alpha",
      department: "ECE",
      votes: 0,
    });
    participant1Id = p1._id.toString();

    const p2 = await ParticipantsModel.create({
      name: "Team Beta",
      department: "ME",
      votes: 0,
    });
    participant2Id = p2._id.toString();
  });

  test("Unauthenticated vote submissions are rejected with 401", async () => {
    const res = await request(app).post(`/voteParticipant/${participant1Id}`);
    expect(res.status).toBe(401);
  });

  test("Valid authenticated voter can submit a permitted vote", async () => {
    const res = await request(app)
      .post(`/voteParticipant/${participant1Id}`)
      .set("Authorization", `Bearer ${voter1Token}`)
      .send({ contestId: "hackathon_2026" });

    expect(res.status).toBe(200);
    expect(res.body.votes).toBe(1);

    // Verify Vote ledger entry exists
    const voteRecord = await VoteModel.findOne({
      voterId: voter1Id,
      participantId: participant1Id,
      contestId: "hackathon_2026",
    });
    expect(voteRecord).toBeTruthy();

    // Verify participant tally
    const participant = await ParticipantsModel.findById(participant1Id);
    expect(participant.votes).toBe(1);
  });

  test("Duplicate submissions for another participant in same contest are rejected with 409", async () => {
    // First vote for Team Alpha
    await request(app)
      .post(`/voteParticipant/${participant1Id}`)
      .set("Authorization", `Bearer ${voter1Token}`)
      .send({ contestId: "hackathon_2026" });

    // Second vote attempt by voter1 for Team Beta in same contest
    const res = await request(app)
      .post(`/voteParticipant/${participant2Id}`)
      .set("Authorization", `Bearer ${voter1Token}`)
      .send({ contestId: "hackathon_2026" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already cast your vote/i);

    // Team Beta should have 0 votes
    const p2 = await ParticipantsModel.findById(participant2Id);
    expect(p2.votes).toBe(0);
  });

  test("Safe retry: submitting identical vote for same participant returns 200 with alreadyVoted flag without incrementing tally", async () => {
    // Initial vote
    await request(app)
      .post(`/voteParticipant/${participant1Id}`)
      .set("Authorization", `Bearer ${voter1Token}`)
      .send({ contestId: "hackathon_2026" });

    // Safe retry
    const retryRes = await request(app)
      .post(`/voteParticipant/${participant1Id}`)
      .set("Authorization", `Bearer ${voter1Token}`)
      .send({ contestId: "hackathon_2026" });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.alreadyVoted).toBe(true);

    // Votes must still be 1, not 2
    const p1 = await ParticipantsModel.findById(participant1Id);
    expect(p1.votes).toBe(1);

    const voteCount = await VoteModel.countDocuments({
      voterId: voter1Id,
      contestId: "hackathon_2026",
    });
    expect(voteCount).toBe(1);
  });

  test("Invalid participant identifiers are rejected safely", async () => {
    // Malformed ID
    const res1 = await request(app)
      .post("/voteParticipant/invalid-id-format")
      .set("Authorization", `Bearer ${voter1Token}`);
    expect(res1.status).toBe(400);

    // Non-existent valid ObjectId
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res2 = await request(app)
      .post(`/voteParticipant/${fakeId}`)
      .set("Authorization", `Bearer ${voter1Token}`);
    expect(res2.status).toBe(404);
  });

  test("Concurrent submissions from distinct voters preserve accurate vote counts without lost updates", async () => {
    // Create 10 distinct voters
    const tokens = [];
    for (let i = 0; i < 10; i++) {
      const user = await User.create({
        name: `Voter ${i}`,
        email: `concurrent_voter_${i}@test.com`,
        password: "password123",
        role: "student",
      });
      tokens.push(jwt.sign({ id: user._id.toString(), role: "student" }, getJwtSecret()));
    }

    // Submit all 10 votes concurrently to participant 1
    const promises = tokens.map((tok) =>
      request(app)
        .post(`/voteParticipant/${participant1Id}`)
        .set("Authorization", `Bearer ${tok}`)
        .send({ contestId: "hackathon_2026" })
    );

    const results = await Promise.all(promises);
    results.forEach((r) => expect(r.status).toBe(200));

    // Verify tally is exactly 10
    const participant = await ParticipantsModel.findById(participant1Id);
    expect(participant.votes).toBe(10);

    const totalVotesInLedger = await VoteModel.countDocuments({
      participantId: participant1Id,
      contestId: "hackathon_2026",
    });
    expect(totalVotesInLedger).toBe(10);
  });

  test("Transient transaction failure retries successfully and commits vote", async () => {
    let attempts = 0;
    const originalFindByIdAndUpdate = ParticipantsModel.findByIdAndUpdate;
    jest.spyOn(ParticipantsModel, "findByIdAndUpdate").mockImplementation(function (...args) {
      attempts++;
      if (attempts === 1) {
        const transientError = new Error("WriteConflict: simulated transient collision");
        transientError.code = 112;
        transientError.errorLabels = ["TransientTransactionError"];
        throw transientError;
      }
      return originalFindByIdAndUpdate.apply(this, args);
    });

    try {
      const res = await request(app)
        .post(`/voteParticipant/${participant1Id}`)
        .set("Authorization", `Bearer ${voter1Token}`)
        .send({ contestId: "hackathon_2026" });

      expect(res.status).toBe(200);
      expect(attempts).toBe(2);

      const participant = await ParticipantsModel.findById(participant1Id);
      expect(participant.votes).toBe(1);

      const totalVotesInLedger = await VoteModel.countDocuments({
        participantId: participant1Id,
        contestId: "hackathon_2026",
      });
      expect(totalVotesInLedger).toBe(1);
    } finally {
      ParticipantsModel.findByIdAndUpdate.mockRestore();
    }
  });

  test("Exhausted retries fail cleanly with HTTP 500 without partial writes", async () => {
    jest.spyOn(ParticipantsModel, "findByIdAndUpdate").mockImplementation(function () {
      const transientError = new Error("WriteConflict: persistent transient collision");
      transientError.code = 112;
      transientError.errorLabels = ["TransientTransactionError"];
      throw transientError;
    });

    try {
      const res = await request(app)
        .post(`/voteParticipant/${participant1Id}`)
        .set("Authorization", `Bearer ${voter1Token}`)
        .send({ contestId: "hackathon_2026" });

      expect(res.status).toBe(500);

      // Verify no partial writes: neither the ledger entry nor the counter increment persisted
      const participant = await ParticipantsModel.findById(participant1Id);
      expect(participant.votes).toBe(0);

      const totalVotesInLedger = await VoteModel.countDocuments({
        participantId: participant1Id,
        contestId: "hackathon_2026",
      });
      expect(totalVotesInLedger).toBe(0);
    } finally {
      ParticipantsModel.findByIdAndUpdate.mockRestore();
    }
  });

  test("Commit uncertainty (UnknownTransactionCommitResult) retries commit without duplicate vote insertion", async () => {
    let commitAttempts = 0;
    const originalStartSession = mongoose.startSession.bind(mongoose);

    jest.spyOn(mongoose, "startSession").mockImplementation(async function (...args) {
      const session = await originalStartSession(...args);
      const originalCommit = session.commitTransaction.bind(session);

      session.commitTransaction = async function () {
        commitAttempts++;
        if (commitAttempts === 1) {
          const unknownCommitErr = new Error("Network timeout during commit");
          unknownCommitErr.errorLabels = ["UnknownTransactionCommitResult"];
          throw unknownCommitErr;
        }
        return originalCommit();
      };

      return session;
    });

    try {
      const res = await request(app)
        .post(`/voteParticipant/${participant1Id}`)
        .set("Authorization", `Bearer ${voter1Token}`)
        .send({ contestId: "hackathon_2026" });

      expect(res.status).toBe(200);
      expect(commitAttempts).toBe(2);

      const participant = await ParticipantsModel.findById(participant1Id);
      expect(participant.votes).toBe(1);

      const totalVotesInLedger = await VoteModel.countDocuments({
        participantId: participant1Id,
        contestId: "hackathon_2026",
      });
      expect(totalVotesInLedger).toBe(1);
    } finally {
      mongoose.startSession.mockRestore();
    }
  });
});

describe("TASK 5: Admin Panel & Search Logic Resilience", () => {
  beforeEach(async () => {
    await ParticipantsModel.create([
      { name: "Team 1", department: "CSE", projectName: "Cloud AI", teamNo: 101 },
      { name: "Team 2", department: undefined, projectName: "Smart Grid", teamNo: 102 },
      { name: "Team 3", department: "", projectName: undefined, teamNo: 103 },
    ]);
  });

  test("API returns both department and projectName fields across all records", async () => {
    const res = await request(app).get("/allParticipants?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);

    res.body.data.forEach((p) => {
      expect(p).toHaveProperty("department");
      expect(p).toHaveProperty("projectName");
    });
  });

  test("Frontend search filter logic executes safely without throwing on missing fields", () => {
    const testParticipants = [
      { _id: "1", name: "Alpha", department: "CSE", projectName: "Robo", teamNo: 1 },
      { _id: "2", name: "Beta", department: undefined, projectName: "Sensor", teamNo: 2 },
      { _id: "3", name: "Gamma", department: null, projectName: null, teamNo: 3 },
      { _id: "4", name: undefined, department: "", projectName: "AI", teamNo: 4 },
    ];

    const safeSearch = (list, query) => {
      const s = (query || "").toLowerCase();
      return list.filter((p) => {
        const nameMatch = p.name ? p.name.toLowerCase().includes(s) : false;
        const deptMatch = p.department ? p.department.toLowerCase().includes(s) : false;
        const projectMatch = p.projectName ? p.projectName.toLowerCase().includes(s) : false;
        const teamMatch = p.teamNo ? p.teamNo.toString().includes(s) : false;
        return nameMatch || deptMatch || projectMatch || teamMatch;
      });
    };

    // Searching with valid, empty, and missing inputs must not throw
    expect(() => safeSearch(testParticipants, "CSE")).not.toThrow();
    expect(safeSearch(testParticipants, "CSE").length).toBe(1);

    expect(() => safeSearch(testParticipants, "")).not.toThrow();
    expect(safeSearch(testParticipants, "").length).toBe(4);

    expect(() => safeSearch(testParticipants, "Sensor")).not.toThrow();
    expect(safeSearch(testParticipants, "Sensor").length).toBe(1);

    expect(() => safeSearch(testParticipants, "NonExistent")).not.toThrow();
    expect(safeSearch(testParticipants, "NonExistent").length).toBe(0);
  });
});
