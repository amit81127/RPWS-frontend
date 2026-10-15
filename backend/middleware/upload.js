const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const path = require("path");
const fs = require("fs");

// Support both CLOUDINARY_URL and individual credentials
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloudinary_url: process.env.CLOUDINARY_URL,
  });
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function isCloudinaryConfigured() {
  const cfg = cloudinary.config();
  return Boolean(cfg.cloud_name && (cfg.api_key || process.env.CLOUDINARY_URL));
}

// 1. Local Disk Storage (guaranteed zero-failure staging & development fallback)
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `participant-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.has(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    const error = new Error("Invalid file type. Only JPEG, PNG, WEBP, and GIF images are allowed.");
    error.code = "INVALID_FILE_TYPE";
    cb(error, false);
  }
};

const diskUpload = multer({
  storage: diskStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB limit
    files: 1,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024, // 1 MB limit per text field
    fields: 15,
  },
  fileFilter,
});

/**
 * Resilient upload middleware:
 * 1. Stages upload on local disk storage via Multer.
 * 2. If Cloudinary is configured, uploads the staged file to Cloudinary CDN with transformation.
 * 3. If Cloudinary succeeds, assigns Cloudinary secure URL and deletes local file.
 * 4. If Cloudinary fails (e.g. invalid cloud_name, network timeout), gracefully preserves the local disk upload at /uploads/ so registration never fails!
 */
function handleUpload(req, res, next) {
  diskUpload.single("image")(req, res, async function (err) {
    if (err) {
      if (typeof req.resume === "function") {
        req.resume();
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "File too large. Maximum permitted image size is 5MB.",
        });
      }
      if (err.code === "INVALID_FILE_TYPE") {
        return res.status(400).json({
          error: err.message,
        });
      }
      return res.status(400).json({ error: err.message || "File upload error" });
    }

    // If a file was uploaded, attempt Cloudinary upload
    if (req.file && req.file.path) {
      if (isCloudinaryConfigured()) {
        try {
          const result = await cloudinary.uploader.upload(req.file.path, {
            folder: "expovote/participants",
            transformation: [
              { width: 1000, height: 1000, crop: "limit", quality: "auto", fetch_format: "auto" },
            ],
          });

          // Cloudinary succeeded: set cloud url and public_id
          const localPath = req.file.path;
          req.file.path = result.secure_url;
          req.file.secure_url = result.secure_url;
          req.file.public_id = result.public_id;
          req.file.filename = result.public_id;

          // Remove temporary local file
          try {
            if (fs.existsSync(localPath)) {
              fs.unlinkSync(localPath);
            }
          } catch (_) {}
        } catch (cloudErr) {
          console.warn("⚠️ Cloudinary upload warning (using local disk fallback):", cloudErr.message);
          // Graceful fallback: set local path relative to server
          req.file.path = `/uploads/${req.file.filename}`;
          req.file.secure_url = `/uploads/${req.file.filename}`;
        }
      } else {
        req.file.path = `/uploads/${req.file.filename}`;
        req.file.secure_url = `/uploads/${req.file.filename}`;
      }
    }

    next();
  });
}

module.exports = {
  handleUpload,
  cloudinary,
  isCloudinaryConfigured,
};
