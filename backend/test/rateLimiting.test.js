const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const app = require("../index");
const User = require("../models/userModel");
const { ParticipantsModel } = require("../models/participantsModels");
const VoteModel = require("../models/voteModel");
const SettingModel = require("../models/settingModel");
const { getJwtSecret } = require("../middleware/auth");
const { setVotingEnabled } = require("../services/voteService");

describe("API Rate Limiting & Proxy Awareness Tests", () => {
  let secret;
  let participant1;
  let participant2;

  beforeAll(async () => {
    secret = getJwtSecret();
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URL);
    }
  });

  beforeEach(async () => {
    // Clear collections for test isolation
    await User.deleteMany({});
    await ParticipantsModel.deleteMany({});
    await VoteModel.deleteMany({});
    await SettingModel.deleteMany({});
    await setVotingEnabled(true);

    // Reset rate limit override env variables
    delete process.env.RATE_LIMIT_AUTH_MAX;
    delete process.env.RATE_LIMIT_UPLOAD_MAX;
    delete process.env.RATE_LIMIT_VOTE_MAX;
    delete process.env.RATE_LIMIT_READ_MAX;

    // Create test participants
    participant1 = await ParticipantsModel.create({
      name: "Smart Water Grid",
      department: "Civil",
      projectName: "WaterGrid",
      votes: 0,
    });

    participant2 = await ParticipantsModel.create({
      name: "Solar Inverter",
      department: "Electrical",
      projectName: "SolarInv",
      votes: 0,
    });
  });

  afterAll(async () => {
    await User.deleteMany({});
    await ParticipantsModel.deleteMany({});
    await VoteModel.deleteMany({});
    // Clean up env overrides
    delete process.env.RATE_LIMIT_AUTH_MAX;
    delete process.env.RATE_LIMIT_UPLOAD_MAX;
    delete process.env.RATE_LIMIT_VOTE_MAX;
    delete process.env.RATE_LIMIT_READ_MAX;
    await mongoose.connection.close();
  });

  // Helper to generate verified student tokens
  const createStudentToken = async (email, name = "Test Student") => {
    const user = await User.create({
      name,
      email,
      password: "password123",
      role: "student",
    });
    const token = jwt.sign(
      { id: user._id.toString(), email: user.email, role: user.role },
      secret,
      { expiresIn: "1h" }
    );
    return { user, token };
  };

  test("1. Returns HTTP 429 when auth endpoint exceeds configured limit", async () => {
    process.env.RATE_LIMIT_AUTH_MAX = "3";
    const testIp = "192.0.2.10";

    // First 3 requests are processed normally (HTTP 401 for wrong credentials)
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/login")
        .set("X-Forwarded-For", testIp)
        .send({ email: "random@aitm.edu.in", password: "wrong" });

      expect(res.status).toBe(401);
      expect(res.headers["ratelimit-limit"]).toBe("3");
    }

    // 4th request exceeds the limit and must be rejected with HTTP 429
    const blockedRes = await request(app)
      .post("/login")
      .set("X-Forwarded-For", testIp)
      .send({ email: "random@aitm.edu.in", password: "wrong" });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toMatch(/too many authentication attempts/i);
    expect(blockedRes.headers["ratelimit-remaining"]).toBe("0");
  });

  test("2. Distinct client IPs have independent rate-limit quotas behind Render proxy", async () => {
    process.env.RATE_LIMIT_AUTH_MAX = "2";
    const ipA = "198.51.100.1";
    const ipB = "198.51.100.2";

    // Exhaust quota for IP A
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post("/login")
        .set("X-Forwarded-For", ipA)
        .send({ email: "a@aitm.edu.in", password: "bad" });
    }

    // IP A is throttled
    const resA = await request(app)
      .post("/login")
      .set("X-Forwarded-For", ipA)
      .send({ email: "a@aitm.edu.in", password: "bad" });
    expect(resA.status).toBe(429);

    // IP B still has full quota and is NOT throttled
    const resB = await request(app)
      .post("/login")
      .set("X-Forwarded-For", ipB)
      .send({ email: "b@aitm.edu.in", password: "bad" });
    expect(resB.status).toBe(401); // Normal auth rejection, not 429
  });

  test("3. Authenticated voting uses verified voter ID as key, protecting shared campus Wi-Fi IP", async () => {
    process.env.RATE_LIMIT_VOTE_MAX = "2";
    const sharedWifiIp = "203.0.113.99";

    const voter1 = await createStudentToken("voter1@aitm.edu.in", "Student One");
    const voter2 = await createStudentToken("voter2@aitm.edu.in", "Student Two");

    // Voter 1 casts vote 1
    const v1Res1 = await request(app)
      .post(`/voteParticipant/${participant1._id}`)
      .set("Authorization", `Bearer ${voter1.token}`)
      .set("X-Forwarded-For", sharedWifiIp)
      .send({ contestId: "contest-a" });
    expect(v1Res1.status).toBe(200);

    // Voter 1 attempts vote 2
    const v1Res2 = await request(app)
      .post(`/voteParticipant/${participant1._id}`)
      .set("Authorization", `Bearer ${voter1.token}`)
      .set("X-Forwarded-For", sharedWifiIp)
      .send({ contestId: "contest-b" });
    expect(v1Res2.status).toBe(200);

    // Voter 1 exceeds quota (attempt 3) and is throttled with HTTP 429
    const v1Res3 = await request(app)
      .post(`/voteParticipant/${participant1._id}`)
      .set("Authorization", `Bearer ${voter1.token}`)
      .set("X-Forwarded-For", sharedWifiIp)
      .send({ contestId: "contest-c" });
    expect(v1Res3.status).toBe(429);
    expect(v1Res3.body.error).toMatch(/too many voting attempts/i);

    // Voter 2 is on the SAME shared campus Wi-Fi IP, but must NOT be throttled
    const v2Res = await request(app)
      .post(`/voteParticipant/${participant2._id}`)
      .set("Authorization", `Bearer ${voter2.token}`)
      .set("X-Forwarded-For", sharedWifiIp)
      .send({ contestId: "contest-a" });
    expect(v2Res.status).toBe(200);
    expect(v2Res.body.message).toBe("Vote counted");
  });

  test("4. Unauthenticated voting requests are rejected with HTTP 401 before rate limiting", async () => {
    const resNoToken = await request(app)
      .post(`/voteParticipant/${participant1._id}`)
      .send();
    expect(resNoToken.status).toBe(401);

    const resBadToken = await request(app)
      .post(`/voteParticipant/${participant1._id}`)
      .set("Authorization", "Bearer invalid-token-string")
      .send();
    expect(resBadToken.status).toBe(401);
  });

  test("5. Preserves duplicate-vote protection and contest segregation alongside rate limiting", async () => {
    const voter = await createStudentToken("duplicate.test@aitm.edu.in");

    // First vote succeeds
    const res1 = await request(app)
      .post(`/voteParticipant/${participant1._id}`)
      .set("Authorization", `Bearer ${voter.token}`)
      .send({ contestId: "robotics-2026" });
    expect(res1.status).toBe(200);
    expect(res1.body.message).toBe("Vote counted");

    // Re-voting for the SAME participant is idempotent (HTTP 200, alreadyVoted: true)
    const resDuplicateSame = await request(app)
      .post(`/voteParticipant/${participant1._id}`)
      .set("Authorization", `Bearer ${voter.token}`)
      .send({ contestId: "robotics-2026" });
    expect(resDuplicateSame.status).toBe(200);
    expect(resDuplicateSame.body.alreadyVoted).toBe(true);

    // Voting for a DIFFERENT participant in the SAME contest returns HTTP 409
    const resDuplicateOther = await request(app)
      .post(`/voteParticipant/${participant2._id}`)
      .set("Authorization", `Bearer ${voter.token}`)
      .send({ contestId: "robotics-2026" });
    expect(resDuplicateOther.status).toBe(409);
    expect(resDuplicateOther.body.error).toMatch(/already cast your vote/i);
  });

  test("6. Read endpoints return standard RateLimit headers and enforce limits", async () => {
    process.env.RATE_LIMIT_READ_MAX = "2";
    const testIp = "192.0.2.77";

    const res1 = await request(app)
      .get("/allParticipants")
      .set("X-Forwarded-For", testIp);
    expect(res1.status).toBe(200);
    expect(res1.headers["ratelimit-limit"]).toBe("2");
    expect(res1.headers["ratelimit-remaining"]).toBe("1");

    const res2 = await request(app)
      .get("/allParticipants")
      .set("X-Forwarded-For", testIp);
    expect(res2.status).toBe(200);
    expect(res2.headers["ratelimit-remaining"]).toBe("0");

    const res3 = await request(app)
      .get("/allParticipants")
      .set("X-Forwarded-For", testIp);
    expect(res3.status).toBe(429);
    expect(res3.body.error).toMatch(/too many requests/i);
  });
});
