const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Create uploads directory if it doesn't exist
const uploadDir = "public/images";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with prefix based on file type
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);

    // Add prefix based on field name
    let prefix = "";
    if (file.fieldname === "transfer_proof") {
      prefix = "transfer-proof-";
    } else if (file.fieldname === "image") {
      prefix = "product-";
    }

    cb(null, `${uniqueSuffix}${ext}`);
  },
});

// File filter for images only
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Single file upload middleware for products
const uploadSingle = upload.single("image");

// Transfer proof upload middleware
const uploadTransferProof = upload.single("transfer_proof");

// Multiple files upload middleware
const uploadMultiple = upload.array("images", 5);

module.exports = {
  uploadSingle,
  uploadTransferProof,
  uploadMultiple,
  upload,
};
