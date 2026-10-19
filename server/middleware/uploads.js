// Two upload paths remain in this version of the site:
//
// 1. ADMIN uploads — blog post cover images (any admin action that needs an image).
//    Trusted role, so we just restrict to image types as a sane default.
//
// 2. CONTACT FORM attachment — a visitor can attach one image to a support/feedback
//    message. Restricted to image types and a configurable max size, enforced here
//    on the server (never trust a client-side check alone).

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const MESSAGE_IMAGE_MAX_BYTES = parseInt(process.env.MESSAGE_IMAGE_MAX_BYTES || '5242880', 10); // 5MB

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeExt(originalName) {
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ext || '';
}

function uniqueFilename(originalName) {
  const stamp = Date.now() + '-' + Math.round(Math.random() * 1e9);
  return `${stamp}${safeExt(originalName)}`;
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// ---------- Admin content images (post covers, etc.) ----------

const adminImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'admin');
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uniqueFilename(file.originalname))
});

const adminImageUpload = multer({
  storage: adminImageStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB ceiling for cover images
  fileFilter: (req, file, cb) => {
    if (!IMAGE_MIMES.includes(file.mimetype)) {
      return cb(new Error('Only image files are allowed here.'));
    }
    cb(null, true);
  }
});

// ---------- Contact/support form attachment ----------

const messageImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'messages');
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uniqueFilename(file.originalname))
});

const messageImageUpload = multer({
  storage: messageImageStorage,
  limits: { fileSize: MESSAGE_IMAGE_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!IMAGE_MIMES.includes(file.mimetype)) {
      return cb(new Error('Only image attachments (JPG, PNG, GIF, WEBP) are allowed.'));
    }
    cb(null, true);
  }
}).single('attachment');

module.exports = {
  adminImageUpload,
  messageImageUpload,
  UPLOAD_ROOT,
  MESSAGE_IMAGE_MAX_BYTES
};
