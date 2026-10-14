const request = require("supertest");
const axios = require("axios");
const app = require("../index");
const { cloudinary } = require("../middleware/upload");
const { ParticipantsModel } = require("../models/participantsModels");

jest.setTimeout(20000);

describe("Isolated Cloudinary Tests (Independent of MongoDB)", () => {
  // Test 1: Image upload middleware and MIME/size validation
  describe("1. Upload Middleware & Validation", () => {
    test("Rejects upload exceeding 2 MB with HTTP 400", async () => {
      const largeBuffer = Buffer.alloc(2.5 * 1024 * 1024, "a");

      const res = await request(app)
        .post("/addParticipants")
        .field("name", "Oversized Test")
        .field("department", "CSE")
        .attach("image", largeBuffer, { filename: "large.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/2MB/i);
    });

    test("Rejects invalid file types (e.g. text or javascript) with HTTP 400", async () => {
      const invalidBuffer = Buffer.from("console.log('malicious script');");

      const res = await request(app)
        .post("/addParticipants")
        .field("name", "Invalid File Test")
        .attach("image", invalidBuffer, { filename: "script.js", contentType: "application/javascript" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Only JPEG, PNG, WEBP, and GIF images are allowed/i);
    });
  });

  // Test 2 & 3: Real Cloudinary upload, HTTPS URL retrieval, and Asset cleanup
  describe("2 & 3. Real Cloudinary Upload, CDN Retrieval & Asset Cleanup", () => {
    let uploadedPublicId = null;
    let uploadedSecureUrl = null;

    test("REAL INTEGRATION: Uploads image directly to Cloudinary and retrieves via HTTPS CDN", async () => {
      // 1x1 valid PNG buffer
      const validPngBuffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      );

      // Perform upload directly using Cloudinary SDK to verify network connectivity and CDN retrieval
      const uploadResult = await cloudinary.uploader.upload(
        `data:image/png;base64,${validPngBuffer.toString("base64")}`,
        { folder: "expovote/participants" }
      );

      expect(uploadResult.secure_url).toBeDefined();
      expect(uploadResult.secure_url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
      expect(uploadResult.public_id).toMatch(/^expovote\/participants\//);

      uploadedPublicId = uploadResult.public_id;
      uploadedSecureUrl = uploadResult.secure_url;

      // Verify real HTTP retrieval from Cloudinary CDN
      const cdnResponse = await axios.get(uploadedSecureUrl, { responseType: "arraybuffer" });
      expect(cdnResponse.status).toBe(200);
      expect(cdnResponse.headers["content-type"]).toMatch(/image\/(png|jpeg)/);
      expect(cdnResponse.data.length).toBeGreaterThan(0);
    });

    test("REAL INTEGRATION: Cleans up uploaded Cloudinary asset via destroy API", async () => {
      expect(uploadedPublicId).toBeDefined();

      const destroyResult = await cloudinary.uploader.destroy(uploadedPublicId);
      expect(destroyResult.result).toBe("ok");
    });
  });

  // Test 4: Mocked database-failure cleanup behavior
  describe("4. Mocked Database-Failure Cleanup Behavior", () => {
    test("MOCKED: Database write failure triggers orphan cleanup and destroys uploaded Cloudinary asset", async () => {
      const destroySpy = jest.spyOn(cloudinary.uploader, "destroy");
      const createSpy = jest.spyOn(ParticipantsModel, "create").mockRejectedValueOnce(
        new Error("Simulated database failure during participant creation")
      );

      const validPngBuffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      );

      try {
        const res = await request(app)
          .post("/addParticipants")
          .field("name", "Orphan Cleanup Test Participant")
          .field("department", "Robotics")
          .attach("image", validPngBuffer, { filename: "test_orphan.png", contentType: "image/png" });

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Simulated database failure/i);

        // Verify that destroy was invoked to clean up the orphaned Cloudinary asset
        expect(destroySpy).toHaveBeenCalled();
        const cleanedUpPublicId = destroySpy.mock.calls[0][0];
        expect(cleanedUpPublicId).toMatch(/expovote\/participants\//);
      } finally {
        createSpy.mockRestore();
        destroySpy.mockRestore();
      }
    });
  });
});
