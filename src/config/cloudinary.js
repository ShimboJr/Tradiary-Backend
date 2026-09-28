/**
 * config/cloudinary.js
 * Cloudinary SDK configuration — call configureCloudinary() once at app startup.
 */

const cloudinary = require('cloudinary').v2;

const configureCloudinary = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log('[cloudinary] ✅  Cloudinary configured.');
};

module.exports = { cloudinary, configureCloudinary };
