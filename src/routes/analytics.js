const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { summary, mistakesSummary } = require('../controllers/analyticsController');

const router = express.Router();
router.use(requireAuth);

router.get('/summary',   summary);
router.get('/mistakes',  mistakesSummary);

module.exports = router;
