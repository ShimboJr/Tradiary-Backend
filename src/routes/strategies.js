/**
 * routes/strategies.js
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/strategyController');
const router = express.Router();
router.use(requireAuth);

router.get('/',            ctrl.list);
router.post('/',           ctrl.create);
router.get('/:id',         ctrl.detail);
router.patch('/:id',       ctrl.update);
router.delete('/:id',      ctrl.remove);
router.get('/:id/trades',  ctrl.trades);

module.exports = router;
