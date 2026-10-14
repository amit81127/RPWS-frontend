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

// =========================================================================
// 1. Student registration and login
// =========================================================================
describe("1. Student registration and login", () => {
  test("Registers a new student successfully with hashed password and returns token", async () => {
    const res = await request(app)
      .post("/signup")
      .send({
        name: "Test Student",
        email: "test.student@example.com",
        password: "securePassword123",
      });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe("test.student@example.com");
    expect(res.body.user.role).toBe("student");
    expect(res.body.user.password).toBeUndefined();

    // Verify stored user in database
    const saved = await User.findOne({ email: "test.student@example.com" });
    expect(saved).toBeTruthy();
    expect(saved.password).not.toBe("securePassword123");
    const valid = await bcrypt.compare("securePassword123", saved.password);
    expect(valid).toBe(true);
  });

  test("Authenticates valid student credentials via /login and normalizes email casing", async () => {
    await request(app).post("/signup").send({
      name: "Case Test",
      email: "casetest@example.com",
      password: "password123",
    });

    // Login with uppercase/mixed email
    const loginRes = await request(app).post("/login").send({
      email: "CaseTest@EXAMPLE.com",
      password: "password123",
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.user.email).toBe("casetest@example.com");
    expect(loginRes.body.user.password).toBeUndefined();
  });

  test("Registers student with valid college email address (@aitm.edu.in)", async () => {
    const res = await request(app)
      .post("/signup")
      .send({
        name: "College Student",
        email: "student.2024@aitm.edu.in",
        password: "password123",
      });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("student.2024@aitm.edu.in");
    expect(res.body.user.role).toBe("student");
    expect(res.body.token).toBeDefined();
  });

  test("Registers attendee with valid external email address (@gmail.com)", async () => {
    const res = await request(app)
      .post("/signup")
      .send({
        name: "External Attendee",
        email: "guest.judge@gmail.com",
        password: "password123",
      });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("guest.judge@gmail.com");
    expect(res.body.user.role).toBe("student");
    expect(res.body.token).toBeDefined();
  });
});

// =========================================================================
// 2. Invalid credentials and duplicate registration
// =========================================================================
describe("2. Invalid credentials and duplicate registration", () => {
  beforeEach(async () => {
    await request(app).post("/signup").send({
      name: "Existing User",
      email: "existing@example.com",
      password: "password123",
    });
  });

  test("Rejects duplicate student registration with HTTP 400", async () => {
    const res = await request(app).post("/signup").send({
      name: "Another Name",
      email: "EXISTING@example.com",
      password: "password456",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test("Rejects login with wrong password with HTTP 401", async () => {
    const res = await request(app).post("/login").send({
      email: "existing@example.com",
      password: "wrongPassword",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  test("Rejects login with non-existent email with HTTP 401", async () => {
    const res = await request(app).post("/login").send({
      email: "nonexistent@example.com",
      password: "password123",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  test("Rejects registration with password shorter than 6 characters with HTTP 400", async () => {
    const res = await request(app).post("/signup").send({
      name: "Short Pass",
      email: "short@example.com",
      password: "123",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 6 characters/i);
  });

  test("Rejects registration with missing or empty required fields", async () => {
    const res1 = await request(app).post("/signup").send({ name: "", email: "a@b.com", password: "pwd" });
    expect(res1.status).toBe(400);

    const res2 = await request(app).post("/signup").send({ name: "A", email: "", password: "pwd" });
    expect(res2.status).toBe(400);

    const res3 = await request(app).post("/signup").send({ name: "A", email: "a@b.com", password: "" });
    expect(res3.status).toBe(400);
  });

  test("Rejects registration with malformed email addresses with HTTP 400 and clear error message", async () => {
    const malformedEmails = [
      "notanemail",
      "user@",
      "@example.com",
      "user@nodot",
      "user@.com",
      "user name@example.com",
    ];

    for (const malformed of malformedEmails) {
      const res = await request(app).post("/signup").send({
        name: "Bad Email User",
        email: malformed,
        password: "password123",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid email address format");
    }
  });
});

// =========================================================================
// 3. Project registration and validation
// =========================================================================
describe("3. Project registration and validation", () => {
  let studentToken;

  beforeEach(async () => {
    const student = await User.create({
      name: "Registering Student",
      email: "registrant@college.edu",
      password: "password123",
      role: "student",
    });
    studentToken = jwt.sign({ id: student._id.toString(), role: "student" }, getJwtSecret());
  });

  test("Rejects project creation when token is missing with HTTP 401", async () => {
    const res = await request(app)
      .post("/addParticipants")
      .field("name", "Unauthorized Project")
      .field("department", "Robotics");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token provided/i);
  });

  test("Rejects project creation when token is invalid or forged with HTTP 401", async () => {
    const res = await request(app)
      .post("/addParticipants")
      .set("Authorization", "Bearer forged.invalid.token")
      .field("name", "Forged Project")
      .field("department", "Robotics");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired token/i);
  });

  test("Successfully creates participant with complete details and reconciles department/projectName", async () => {
    const res = await request(app)
      .post("/addParticipants")
      .set("Authorization", `Bearer ${studentToken}`)
      .field("name", "Autonomous Rover Project")
      .field("department", "Robotics")
      .field("projectName", "AutoRover v2")
      .field("email", "team@rover.org")
      .field("description", "An autonomous rover navigating obstacles")
      .field("teamNo", "42");

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.name).toBe("Autonomous Rover Project");
    expect(res.body.data.department).toBe("Robotics");
    expect(res.body.data.projectName).toBe("AutoRover v2");
    expect(res.body.data.teamNo).toBe(42);
    expect(res.body.data.votes).toBe(0);
    expect(res.body.data.image).toMatch(/^https?:\/\//);
  });

  test("Rejects project creation when name is missing or whitespace only with HTTP 400", async () => {
    const res = await request(app)
      .post("/addParticipants")
      .set("Authorization", `Bearer ${studentToken}`)
      .field("name", "   ")
      .field("department", "CSE");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name is required/i);
  });

  test("Correctly falls back when only department or only projectName is provided", async () => {
    const res = await request(app)
      .post("/addParticipants")
      .set("Authorization", `Bearer ${studentToken}`)
      .field("name", "Fallback Project")
      .field("department", "Computer Science");

    expect(res.status).toBe(201);
    expect(res.body.data.department).toBe("Computer Science");
    expect(res.body.data.projectName).toBe("Computer Science");
  });

  test("Submitted projectName and department remain distinct in database records without overwriting", async () => {
    const res = await request(app)
      .post("/addParticipants")
      .set("Authorization", `Bearer ${studentToken}`)
      .field("teamNo", "77")
      .field("name", "Team CyberShield")
      .field("projectName", "Quantum Encryption Gateway")
      .field("department", "Cyber Security")
      .field("email", "cybershield@college.edu")
      .field("description", "Next-gen post-quantum encryption protocol");

    expect(res.status).toBe(201);
    expect(res.body.data.projectName).toBe("Quantum Encryption Gateway");
    expect(res.body.data.department).toBe("Cyber Security");
    expect(res.body.data.projectName).not.toBe(res.body.data.department);

    // Verify stored document in MongoDB
    const participantInDb = await ParticipantsModel.findById(res.body.data._id);
    expect(participantInDb.projectName).toBe("Quantum Encryption Gateway");
    expect(participantInDb.department).toBe("Cyber Security");
    expect(participantInDb.projectName).not.toBe(participantInDb.department);
  });
});

// =========================================================================
// 4. Image upload and upload failures
// =========================================================================
describe("4. Image upload and upload failures", () => {
  let studentToken;

  beforeEach(async () => {
    const student = await User.create({
      name: "Upload Student",
      email: "uploader@college.edu",
      password: "password123",
      role: "student",
    });
    studentToken = jwt.sign({ id: student._id.toString(), role: "student" }, getJwtSecret());
  });

  test("Rejects upload exceeding 2 MB size limit with HTTP 400", async () => {
    // Allocate buffer just exceeding 2 MB limit (2 MB + 64 KB)
    const oversizedBuffer = Buffer.alloc(2 * 1024 * 1024 + 64 * 1024, "z");

    const res = await request(app)
      .post("/addParticipants")
      .set("Authorization", `Bearer ${studentToken}`)
      .field("name", "Heavy Image Project")
      .field("department", "Civil")
      .attach("image", oversizedBuffer, { filename: "heavy.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2MB/i);
  }, 60000);

  test("Rejects non-image file formats (e.g. executable/script) with HTTP 400", async () => {
    const scriptBuffer = Buffer.from("alert('xss');");

    const res = await request(app)
      .post("/addParticipants")
      .set("Authorization", `Bearer ${studentToken}`)
      .field("name", "Malicious Project")
      .field("department", "IT")
      .attach("image", scriptBuffer, { filename: "exploit.js", contentType: "application/javascript" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only JPEG, PNG, WEBP, and GIF images are allowed/i);
  });

  test("Assigns placeholder image when no image file or URL is provided", async () => {
    const res = await request(app)
      .post("/addParticipants")
      .set("Authorization", `Bearer ${studentToken}`)
      .field("name", "No Photo Project")
      .field("department", "Electrical");

    expect(res.status).toBe(201);
    expect(res.body.data.image).toBe("https://via.placeholder.com/300");
  });
});

// =========================================================================
// 5. Successful voting
// =========================================================================
describe("5. Successful voting", () => {
  let studentToken;
  let studentId;
  let participantId;

  beforeEach(async () => {
    const student = await User.create({
      name: "Voting Student",
      email: "voter@college.edu",
      password: "password123",
      role: "student",
    });
    studentId = student._id.toString();
    studentToken = jwt.sign({ id: studentId, role: "student" }, getJwtSecret());

    const p = await ParticipantsModel.create({
      name: "Solar Energy Project",
      department: "EEE",
      votes: 0,
    });
    participantId = p._id.toString();
  });

  test("Authenticated student successfully casts a vote and increments tally", async () => {
    const res = await request(app)
      .post(`/voteParticipant/${participantId}`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ contestId: "expo_2026" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Vote counted");
    expect(res.body.votes).toBe(1);

    // Verify participant tally in DB
    const p = await ParticipantsModel.findById(participantId);
    expect(p.votes).toBe(1);

    // Verify ledger entry
    const voteRecord = await VoteModel.findOne({
      voterId: studentId,
      participantId: participantId,
      contestId: "expo_2026",
    });
    expect(voteRecord).toBeTruthy();
  });
});

// =========================================================================
// 6. Duplicate-vote rejection
// =========================================================================
describe("6. Duplicate-vote rejection", () => {
  let studentToken;
  let p1Id;
  let p2Id;

  beforeEach(async () => {
    const student = await User.create({
      name: "Strict Voter",
      email: "strict.voter@college.edu",
      password: "password123",
      role: "student",
    });
    studentToken = jwt.sign({ id: student._id.toString(), role: "student" }, getJwtSecret());

    const p1 = await ParticipantsModel.create({ name: "Project Alpha", votes: 0 });
    const p2 = await ParticipantsModel.create({ name: "Project Beta", votes: 0 });
    p1Id = p1._id.toString();
    p2Id = p2._id.toString();
  });

  test("Rejects vote for different participant in same contest with HTTP 409", async () => {
    // Vote 1 for Alpha
    await request(app)
      .post(`/voteParticipant/${p1Id}`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ contestId: "tech_expo" });

    // Vote 2 for Beta in same contest
    const res = await request(app)
      .post(`/voteParticipant/${p2Id}`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ contestId: "tech_expo" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already cast your vote in this contest/i);

    const beta = await ParticipantsModel.findById(p2Id);
    expect(beta.votes).toBe(0);
  });

  test("Submitting identical vote for same participant is idempotent (HTTP 200, alreadyVoted=true)", async () => {
    // First submission
    await request(app)
      .post(`/voteParticipant/${p1Id}`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ contestId: "tech_expo" });

    // Repeated submission
    const retryRes = await request(app)
      .post(`/voteParticipant/${p1Id}`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ contestId: "tech_expo" });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.alreadyVoted).toBe(true);

    // Votes must remain 1
    const alpha = await ParticipantsModel.findById(p1Id);
    expect(alpha.votes).toBe(1);
  });

  test("Permits voting in different contests by the same voter", async () => {
    // Vote in Contest A
    const resA = await request(app)
      .post(`/voteParticipant/${p1Id}`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ contestId: "contest_A" });
    expect(resA.status).toBe(200);

    // Vote in Contest B
    const resB = await request(app)
      .post(`/voteParticipant/${p2Id}`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ contestId: "contest_B" });
    expect(resB.status).toBe(200);
  });
});

// =========================================================================
// 7. Unauthorized voting attempts
// =========================================================================
describe("7. Unauthorized voting attempts", () => {
  let participantId;

  beforeEach(async () => {
    const p = await ParticipantsModel.create({ name: "Secure Project", votes: 0 });
    participantId = p._id.toString();
  });

  test("Unauthenticated vote request returns HTTP 401", async () => {
    const res = await request(app).post(`/voteParticipant/${participantId}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/No token provided/i);
  });

  test("Invalid or forged JWT token returns HTTP 401", async () => {
    const res = await request(app)
      .post(`/voteParticipant/${participantId}`)
      .set("Authorization", "Bearer invalid.jwt.token.here");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid or expired token/i);
  });

  test("Vote with malformed participant ID returns HTTP 400", async () => {
    const token = jwt.sign({ id: new mongoose.Types.ObjectId().toString(), role: "student" }, getJwtSecret());
    const res = await request(app)
      .post("/voteParticipant/not-a-valid-id")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid participant identifier/i);
  });

  test("Vote for non-existent participant ID returns HTTP 404", async () => {
    const token = jwt.sign({ id: new mongoose.Types.ObjectId().toString(), role: "student" }, getJwtSecret());
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post(`/voteParticipant/${fakeId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Participant not found/i);
  });
});

// =========================================================================
// 8. Admin authentication and authorization
// =========================================================================
describe("8. Admin authentication and authorization", () => {
  let studentToken;
  let adminToken;
  let participantId;

  beforeEach(async () => {
    const student = await User.create({
      name: "Regular Student",
      email: "student_auth@college.edu",
      password: "password123",
      role: "student",
    });
    studentToken = jwt.sign({ id: student._id.toString(), role: student.role }, getJwtSecret());

    const admin = await User.create({
      name: "Admin User",
      email: "admin_auth@college.edu",
      password: "password123",
      role: "admin",
    });
    adminToken = jwt.sign({ id: admin._id.toString(), role: admin.role }, getJwtSecret());

    const p = await ParticipantsModel.create({ name: "Admin Controlled Project", votes: 0 });
    participantId = p._id.toString();
  });

  test("Student attempting admin deletion receives HTTP 403 Forbidden", async () => {
    const res = await request(app)
      .delete(`/deleteParticipant/${participantId}`)
      .set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Administrator privileges required/i);
  });

  test("Student attempting admin vote reconciliation receives HTTP 403 Forbidden", async () => {
    const res = await request(app)
      .post("/admin/reconcileVotes")
      .set("Authorization", `Bearer ${studentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Administrator privileges required/i);
  });

  test("Admin successfully authorizes and executes deletion", async () => {
    const res = await request(app)
      .delete(`/deleteParticipant/${participantId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Deleted");

    const check = await ParticipantsModel.findById(participantId);
    expect(check).toBeNull();
  });
});

// =========================================================================
// 9. Participant management
// =========================================================================
describe("9. Participant management", () => {
  let adminToken;

  beforeEach(async () => {
    const admin = await User.create({
      name: "Admin",
      email: "admin_manage@college.edu",
      password: "password123",
      role: "admin",
    });
    adminToken = jwt.sign({ id: admin._id.toString(), role: "admin" }, getJwtSecret());
  });

  test("Deletes participant and cascades vote ledger cleanup", async () => {
    const p = await ParticipantsModel.create({ name: "Cascade Project", votes: 2 });
    const voterId1 = new mongoose.Types.ObjectId();
    const voterId2 = new mongoose.Types.ObjectId();

    await VoteModel.create([
      { voterId: voterId1, participantId: p._id, contestId: "default" },
      { voterId: voterId2, participantId: p._id, contestId: "default" },
    ]);

    const res = await request(app)
      .delete(`/deleteParticipant/${p._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    // Verify participant is deleted
    const checkP = await ParticipantsModel.findById(p._id);
    expect(checkP).toBeNull();

    // Verify associated votes are cleaned up
    const remainingVotes = await VoteModel.countDocuments({ participantId: p._id });
    expect(remainingVotes).toBe(0);
  });

  test("GET /allParticipants supports pagination and clamps limit to 50", async () => {
    const docs = [];
    for (let i = 1; i <= 20; i++) {
      docs.push({ name: `Project ${i}`, department: "CSE", votes: i });
    }
    await ParticipantsModel.create(docs);

    // Fetch page 1 with limit 5
    const res = await request(app).get("/allParticipants?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);
    expect(res.body.meta.total).toBe(20);
    expect(res.body.meta.hasMore).toBe(true);

    // Verify limit clamping (requesting 1000 returns max 50)
    const clampRes = await request(app).get("/allParticipants?page=1&limit=1000");
    expect(clampRes.status).toBe(200);
    expect(clampRes.body.meta.limit).toBe(50);
  });
});

// =========================================================================
// 10. Leaderboard accuracy
// =========================================================================
describe("10. Leaderboard accuracy", () => {
  beforeEach(async () => {
    await ParticipantsModel.create([
      { name: "Low Score Project", department: "ME", votes: 5 },
      { name: "Top Score Project", department: "CSE", votes: 45 },
      { name: "Mid Score Project", department: "ECE", votes: 25 },
      { name: "Tied Score Project A", department: "CIVIL", votes: 15 },
      { name: "Tied Score Project B", department: "AIML", votes: 15 },
    ]);
  });

  test("GET /allParticipantsByVotes returns participants sorted strictly by votes descending", async () => {
    const res = await request(app).get("/allParticipantsByVotes?page=1&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);

    const votes = res.body.data.map((p) => p.votes);
    expect(votes[0]).toBe(45);
    expect(votes[1]).toBe(25);
    expect(votes[2]).toBe(15);
    expect(votes[3]).toBe(15);
    expect(votes[4]).toBe(5);
  });

  test("Leaderboard projection omits heavy unneeded fields", async () => {
    const res = await request(app).get("/allParticipantsByVotes?page=1&limit=5");
    expect(res.status).toBe(200);

    res.body.data.forEach((p) => {
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("votes");
      expect(p).toHaveProperty("image");
      expect(p.description).toBeUndefined();
      expect(p.email).toBeUndefined();
    });
  });
});

// =========================================================================
// 11. Winner page data
// =========================================================================
describe("11. Winner page data", () => {
  test("Provides correct contract structure for frontend WinnerPage rendering", async () => {
    await ParticipantsModel.create([
      { name: "1st Place Winner", department: "CSE", votes: 100 },
      { name: "2nd Place Winner", department: "ECE", votes: 80 },
      { name: "3rd Place Winner", department: "ME", votes: 60 },
    ]);

    const res = await request(app).get("/allParticipantsByVotes?page=1&limit=6");
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);

    const first = res.body.data[0];
    expect(first.name).toBe("1st Place Winner");
    expect(first.votes).toBe(100);
    expect(first.department).toBe("CSE");
    expect(first.image).toBeDefined();

    // Calculate relative percentage as WinnerPage.js does
    const maxVotes = res.body.data[0].votes;
    const progressValues = res.body.data.map((w) => (w.votes / maxVotes) * 100);
    expect(progressValues[0]).toBe(100);
    expect(progressValues[1]).toBe(80);
    expect(progressValues[2]).toBe(60);
  });

  test("Gracefully handles zero-vote scenarios without NaN in data", async () => {
    await ParticipantsModel.create([
      { name: "Zero Vote Winner", department: "CSE", votes: 0 },
    ]);

    const res = await request(app).get("/allParticipantsByVotes?page=1&limit=6");
    expect(res.status).toBe(200);
    expect(res.body.data[0].votes).toBe(0);
  });
});

// =========================================================================
// 12. API error handling
// =========================================================================
describe("12. API error handling", () => {
  test("Health check endpoint returns status ok and database connected", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toMatch(/ok/i);
    expect(res.body.database).toMatch(/connected/i);
  });

  test("Root endpoint returns operational greeting", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Rating API Running/i);
  });

  test("Invalid participant image ID safely redirects to placeholder", async () => {
    const res = await request(app).get("/participantImage/invalid-object-id");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://via.placeholder.com/300");
  });

  test("Non-existent participant image ID safely redirects to placeholder", async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`/participantImage/${fakeId}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://via.placeholder.com/300");
  });

  test("Rejects delete request with malformed ObjectId with HTTP 400", async () => {
    const admin = await User.create({ name: "A", email: "a@c.com", password: "p", role: "admin" });
    const adminToken = jwt.sign({ id: admin._id.toString(), role: "admin" }, getJwtSecret());

    const res = await request(app)
      .delete("/deleteParticipant/malformed-id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid participant identifier/i);
  });
});
