/**
 * routes/accounts.js
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/accountController');

const router = express.Router();
router.use(requireAuth);

router.get('/',    ctrl.list);
router.post('/',   ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
