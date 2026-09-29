/**
 * controllers/uploadController.js
 * Screenshot upload → Cloudinary. Returns { url, publicId }.
 * Avatar upload → Cloudinary (face crop, 256×256) → saves to user.avatarUrl.
 */

const cloudinary = require('cloudinary').v2;
const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.uploadScreenshot = async (req, res, next) => {
  try {
    if (!req.file) return sendError(res, 400, 'No file uploaded.', 'NO_FILE');

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `tradiary/screenshots/${req.user.id}`,
          resource_type: 'image',
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    return sendSuccess(res, 201, { url: result.secure_url, publicId: result.public_id });
  } catch (err) { next(err); }
};

// ── Avatar upload ─────────────────────────────────────────────────────────────
exports.uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) return sendError(res, 400, 'No file uploaded.', 'NO_FILE');

    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found.', 'NOT_FOUND');

    // Delete old Cloudinary avatar if it was uploaded there (public_id is in the URL)
    if (user.avatarUrl && user.avatarUrl.includes('cloudinary.com')) {
      try {
        // Extract public_id from the URL: ...tradiary/avatars/userId/filename
        const urlParts = user.avatarUrl.split('/');
        const versionIndex = urlParts.findIndex(p => p.startsWith('v') && /^v\d+$/.test(p));
        if (versionIndex !== -1) {
          const publicId = urlParts.slice(versionIndex + 1).join('/').replace(/\.[^/.]+$/, '');
          await cloudinary.uploader.destroy(publicId);
        }
      } catch { /* non-critical — continue even if deletion fails */ }
    }

    // Upload new avatar: 256×256 face-centred crop, auto quality & format
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder:        `tradiary/avatars/${req.user.id}`,
          resource_type: 'image',
          transformation: [
            { width: 256, height: 256, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' },
          ],
          // Overwrite previous avatar with the same public_id so Cloudinary storage stays clean
          public_id:  'avatar',
          overwrite:  true,
          invalidate: true,
        },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    // Persist new URL to the user document
    user.avatarUrl = result.secure_url;
    await user.save();

    // Return a safe public user object (same shape as authController.publicUser)
    return sendSuccess(res, 200, {
      id:              user._id,
      name:            user.name,
      email:           user.email,
      avatarUrl:       user.avatarUrl,
      isEmailVerified: user.isEmailVerified,
      authProviders:   user.authProviders,
      timezone:        user.timezone,
      baseCurrency:    user.baseCurrency,
      theme:           user.theme,
      role:            user.role,
    }, 'Avatar updated.');
  } catch (err) { next(err); }
};

