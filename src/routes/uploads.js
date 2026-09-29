/**
 * routes/uploads.js
 * Screenshot upload — multer (memory) + Cloudinary.
 */
const express  = require('express');
const multer   = require('multer');
const { requireAuth } = require('../middleware/auth');
const { uploadScreenshot } = require('../controllers/uploadController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  },
});

const router = express.Router();
router.post('/screenshot', requireAuth, upload.single('screenshot'), uploadScreenshot);

module.exports = router;
