/**
 * routes/auth.js
 * All auth endpoints under /api/auth.
 */

const express = require('express');
const {
  register,
  login,
  googleAuth,
  refresh,
  logout,
  logoutAll,
  getMe,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter, forgotPasswordLimiter } = require('../middleware/rateLimiter');
const {
  registerValidators,
  loginValidators,
  googleValidators,
  forgotPasswordValidators,
  resetPasswordValidators,
} = require('../middleware/validators/authValidators');

const router = express.Router();

// Apply auth rate limiter to all auth routes
router.use(authLimiter);

// ── Public ────────────────────────────────────────────────────────────────────
router.post('/register',  registerValidators, validate, register);
router.post('/login',     loginValidators,    validate, login);
router.post('/google',    googleValidators,   validate, googleAuth);
router.post('/refresh',   refresh);
router.post('/logout',    logout);

router.get ('/verify-email/:token', verifyEmail);

router.post('/forgot-password', forgotPasswordLimiter, forgotPasswordValidators, validate, forgotPassword);
router.post('/reset-password/:token', resetPasswordValidators, validate, resetPassword);

// ── Protected ─────────────────────────────────────────────────────────────────
router.get ('/me',                  requireAuth, getMe);
router.post('/resend-verification', requireAuth, resendVerification);
router.post('/logout-all',          requireAuth, logoutAll);

module.exports = router;
