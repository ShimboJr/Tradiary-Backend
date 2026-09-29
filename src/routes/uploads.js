/**
 * routes/uploads.js
 * Screenshot and avatar uploads — multer (memory) + Cloudinary.
 */
const express  = require('express');
const multer   = require('multer');
const { requireAuth } = require('../middleware/auth');
const { uploadScreenshot, uploadAvatar } = require('../controllers/uploadController');

// Shared image-only filter
const imageFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image files are allowed.'));
};

const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: imageFilter,
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },  // 5 MB — avatars don't need more
  fileFilter: imageFilter,
});

const router = express.Router();
router.post('/screenshot', requireAuth, screenshotUpload.single('screenshot'), uploadScreenshot);
router.post('/avatar',     requireAuth, avatarUpload.single('image'),           uploadAvatar);

module.exports = router;
