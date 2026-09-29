/**
 * routes/journal.js
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/journalController');
const router = express.Router();
router.use(requireAuth);

router.get('/mood-chart',  ctrl.moodChart);  // must be before /:date
router.get('/',            ctrl.list);
router.get('/:date',       ctrl.getByDate);
router.put('/:date',       ctrl.upsert);
router.delete('/:date',    ctrl.remove);

module.exports = router;
