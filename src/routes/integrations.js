/**
 * routes/integrations.js
 * Two groups:
 *  1. /integrations/metatrader/webhook  — EA token auth (X-Tradiary-Token), separate rate limit
 *  2. /integrations/tokens/*            — JWT auth, settings UI token management
 */

'use strict';

const express   = require('express');
const { requireAuth } = require('../middleware/auth');
const { webhookLimiter } = require('../middleware/rateLimiter');
const validate  = require('../middleware/validate');
const ctrl      = require('../controllers/metatraderController');

const router = express.Router();

// ─── Webhook (EA → Tradiary) ─────────────────────────────────────────────────
// Auth: X-Tradiary-Token header — NOT the JWT, because the EA can't do OAuth.
// Rate-limited separately from the global limiter.
router.post(
  '/metatrader/webhook',
  webhookLimiter,
  ctrl.webhookValidators,
  validate,
  ctrl.webhook
);

// ─── Token management (Settings UI → Tradiary) ───────────────────────────────
router.use(requireAuth);

router.get('/tokens',                    ctrl.listTokens);
router.post('/tokens',                   ctrl.createToken);
router.delete('/tokens/:id',             ctrl.revokeToken);
router.post('/tokens/:id/regenerate',    ctrl.regenerateToken);

module.exports = router;
