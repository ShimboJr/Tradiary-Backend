/**
 * routes/users.js
 * Profile management, password, export, and account deletion.
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/usersController');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();
router.use(requireAuth);

router.patch('/me',                   ctrl.updateProfile);
router.post('/me/change-password',    ctrl.changePassword);
router.post('/me/set-password',       ctrl.setPassword);
router.get('/me/export',              ctrl.exportData);
router.delete('/me',                  ctrl.deleteAccount);

module.exports = router;
