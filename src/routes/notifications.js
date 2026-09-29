/**
 * routes/notifications.js
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/notificationsController');

const router = express.Router();
router.use(requireAuth);

router.get('/',                    ctrl.list);
router.patch('/:id/read',          ctrl.markRead);
router.post('/mark-all-read',      ctrl.markAllRead);

module.exports = router;
