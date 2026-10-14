const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// Configure Cloudinary credentials exclusively from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Cloudinary storage for participant uploads
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "expovote/participants",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
    resource_type: "image",
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

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB limit
    files: 1,
  },
  fileFilter,
});

// Middleware wrapper to handle Multer and Cloudinary errors with appropriate HTTP status codes
function handleUpload(req, res, next) {
  upload.single("image")(req, res, function (err) {
    if (err) {
      if (typeof req.resume === "function") {
        req.resume();
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "File too large. Maximum permitted image size is 2MB.",
        });
      }
      if (err.code === "INVALID_FILE_TYPE") {
        return res.status(400).json({
          error: err.message,
        });
      }
      return res.status(400).json({ error: err.message || "File upload error" });
    }
    next();
  });
}

module.exports = {
  upload,
  handleUpload,
  cloudinary,
};
