/**
 * middleware/rateLimiter.js  (replaced from scaffold)
 * Rate limiters — global + auth-specific (aggressive).
 */

const rateLimit = require('express-rate-limit');

const envelope = (message, code) => ({
  success: false,
  error: { message, code },
});

/** Applied globally to every request — 300/15min */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: envelope('Too many requests. Please slow down.', 'RATE_LIMITED'),
});

/** Auth routes — 20 req/15min per IP */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: envelope('Too many auth attempts. Please try again later.', 'AUTH_RATE_LIMITED'),
});

/** Forgot-password — very strict: 5/hour */
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: envelope('Too many reset requests. Please try again in an hour.', 'RESET_RATE_LIMITED'),
});

/** MetaTrader EA webhook — 10 req/min per IP. A single terminal never needs more. */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: envelope('Too many webhook requests.', 'WEBHOOK_RATE_LIMITED'),
});

module.exports = { globalLimiter, authLimiter, forgotPasswordLimiter, webhookLimiter };
