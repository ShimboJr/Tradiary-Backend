/**
 * controllers/uploadController.js
 * Screenshot upload → Cloudinary. Returns { url, publicId }.
 */

const cloudinary = require('cloudinary').v2;
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
