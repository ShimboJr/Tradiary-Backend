/**
 * routes/trades.js
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl         = require('../controllers/tradeController');
const replayCtrl   = require('../controllers/replayController');

const router = express.Router();
router.use(requireAuth);

// ── Named routes (before :id) ─────────────────────────────────────────────────
router.get('/export',          ctrl.exportCsv);
router.get('/calendar',        ctrl.calendarData);
router.post('/bulk-delete',    ctrl.bulkDelete);
router.post('/bulk-tag',       ctrl.bulkTag);
router.post('/import',         ctrl.importCsv);
router.post('/seed-samples',   ctrl.seedSamples);
router.delete('/clear-samples',ctrl.clearSamples);

// ── Standard CRUD ──────────────────────────────────────────────────────────────
router.get('/',        ctrl.list);
router.post('/',       ctrl.create);
router.get('/:id',     ctrl.detail);
router.patch('/:id',   ctrl.update);
router.delete('/:id',  ctrl.remove);

// ── Replay ──────────────────────────────────────────────────────────────────────
router.get('/:id/replay-data', replayCtrl.getReplayData);

module.exports = router;
