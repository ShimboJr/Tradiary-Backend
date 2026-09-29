/**
 * routes/analytics.js
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { summary } = require('../controllers/analyticsController');

const router = express.Router();
router.use(requireAuth);

router.get('/summary', summary);

module.exports = router;
