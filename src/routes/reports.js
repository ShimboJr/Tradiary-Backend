/**
 * routes/reports.js
 * PDF performance report + shareable trade card image.
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/reportsController');

const router = express.Router();
router.use(requireAuth);

// GET /api/reports/pdf?from=DATE&to=DATE&accountId=ID
router.get('/pdf', ctrl.generatePdf);

// GET /api/reports/trade-card/:tradeId
router.get('/trade-card/:tradeId', ctrl.generateTradeCard);

module.exports = router;
