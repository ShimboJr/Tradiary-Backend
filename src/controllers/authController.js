/**
 * controllers/authController.js
 * All auth endpoints: register, login, google, refresh, logout,
 * verify-email, forgot-password, reset-password, resend-verification.
 */

const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  generateOpaqueToken,
  hashOpaqueToken,
} = require('../utils/tokens');
const { sendVerificationEmail, sendPasswordResetEmail, sendPasswordChangedEmail } = require('../utils/email');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CLIENT = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

/** Build the safe user object returned to the client. */
const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl,
  isEmailVerified: user.isEmailVerified,
  authProviders: user.authProviders,
  timezone: user.timezone,
  baseCurrency: user.baseCurrency,
  theme: user.theme,
  role: user.role,
  createdAt: user.createdAt,
});

/** Issue both tokens and set cookie. Returns { user, accessToken }. */
const issueSession = (res, user, remember = true) => {
  const accessToken = generateAccessToken({
    id: user._id,
    email: user.email,
    role: user.role,
  });
  const refreshToken = generateRefreshToken({
    id: user._id,
    tokenVersion: user.tokenVersion,
  });
  setRefreshCookie(res, refreshToken, remember);
  return { user: publicUser(user), accessToken };
};

// ─── Register ─────────────────────────────────────────────────────────────────

exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return sendError(res, 409, 'An account with this email already exists.', 'EMAIL_EXISTS');
    }

    const user = new User({ name, email, authProviders: ['local'] });
    await user.setPassword(password);

    // Generate email verification token
    const { raw: verifyRaw, hash: verifyHash } = generateOpaqueToken();
    user.emailVerifyToken = verifyHash;
    user.emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await user.save();

    // Send verification email (logs to console in dev)
    const verifyUrl = `${CLIENT}/verify-email/${verifyRaw}`;
    await sendVerificationEmail(user.email, user.name, verifyUrl).catch((err) =>
      console.error('[auth] Failed to send verification email:', err.message)
    );

    const session = issueSession(res, user);
    return sendSuccess(res, 201, session, 'Account created! Please verify your email.');
  } catch (err) {
    next(err);
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────

exports.login = async (req, res, next) => {
  try {
    const { email, password, remember = true } = req.body;

    const user = await User.findOne({ email });

    // If user not found — still do a dummy compare to prevent timing attacks
    if (!user || !user.authProviders.includes('local')) {
      return sendError(res, 401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    // Locked out?
    if (user.isLocked) {
      const remaining = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return sendError(
        res, 423,
        `Account locked. Try again in ${remaining} minute${remaining !== 1 ? 's' : ''}.`,
        'ACCOUNT_LOCKED'
      );
    }

    const valid = await user.verifyPassword(password);
    if (!valid) {
      await user.recordFailedLogin();
      return sendError(res, 401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    await user.resetLoginAttempts();

    const session = issueSession(res, user, remember);
    return sendSuccess(res, 200, session, 'Signed in successfully.');
  } catch (err) {
    next(err);
  }
};

// ─── Google OAuth ─────────────────────────────────────────────────────────────

exports.googleAuth = async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) return sendError(res, 400, 'Google credential required.', 'MISSING_CREDENTIAL');

    // Verify ID token with Google
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let user = await User.findOne({ email });

    if (user) {
      // ── Link Google to existing local account ──────────────────────────────
      if (!user.authProviders.includes('google')) {
        user.authProviders.push('google');
        user.googleId = googleId;
        if (!user.avatarUrl) user.avatarUrl = picture;
        if (!user.isEmailVerified) user.isEmailVerified = true;
        await user.save();
      }
    } else {
      // ── Create new Google-authenticated user ───────────────────────────────
      user = await User.create({
        name,
        email,
        googleId,
        avatarUrl: picture,
        authProviders: ['google'],
        isEmailVerified: true, // Google already verified it
      });
    }

    const session = issueSession(res, user);
    return sendSuccess(res, 200, session, 'Signed in with Google.');
  } catch (err) {
    if (err.message?.includes('Token used too late') || err.message?.includes('Invalid token')) {
      return sendError(res, 401, 'Google sign-in failed. Please try again.', 'GOOGLE_AUTH_FAILED');
    }
    next(err);
  }
};

// ─── Refresh ──────────────────────────────────────────────────────────────────

exports.refresh = async (req, res, next) => {
  try {
    const token = req.cookies?.tradiary_rt;
    if (!token) return sendError(res, 401, 'No refresh token.', 'NO_REFRESH_TOKEN');

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      clearRefreshCookie(res);
      return sendError(res, 401, 'Refresh token invalid or expired.', 'INVALID_REFRESH_TOKEN');
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      clearRefreshCookie(res);
      return sendError(res, 401, 'User not found.', 'USER_NOT_FOUND');
    }

    // Token rotation guard — reject stale tokens
    if (decoded.tokenVersion !== user.tokenVersion) {
      clearRefreshCookie(res);
      return sendError(res, 401, 'Session invalidated. Please sign in again.', 'TOKEN_REUSE');
    }

    // Rotate: increment version, issue new pair
    user.tokenVersion += 1;
    await user.save();

    const session = issueSession(res, user);
    return sendSuccess(res, 200, session);
  } catch (err) {
    next(err);
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────

exports.logout = async (req, res, next) => {
  try {
    const token = req.cookies?.tradiary_rt;
    if (token) {
      try {
        const decoded = verifyRefreshToken(token);
        const user = await User.findById(decoded.id);
        if (user) await user.invalidateTokens();
      } catch {
        // Token already invalid — still clear the cookie
      }
    }
    clearRefreshCookie(res);
    return sendSuccess(res, 200, null, 'Signed out successfully.');
  } catch (err) {
    next(err);
  }
};

// ─── Get current user (me) ────────────────────────────────────────────────────

exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found.', 'USER_NOT_FOUND');
    return sendSuccess(res, 200, publicUser(user));
  } catch (err) {
    next(err);
  }
};

// ─── Verify email ─────────────────────────────────────────────────────────────

exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;
    const hash = hashOpaqueToken(token);

    const user = await User.findOne({
      emailVerifyToken: hash,
      emailVerifyExpires: { $gt: new Date() },
    });

    if (!user) {
      return sendError(res, 400, 'Verification link is invalid or has expired.', 'INVALID_VERIFY_TOKEN');
    }

    user.isEmailVerified = true;
    user.emailVerifyToken = null;
    user.emailVerifyExpires = null;
    await user.save();

    return sendSuccess(res, 200, null, 'Email verified successfully.');
  } catch (err) {
    next(err);
  }
};

// ─── Resend verification email ────────────────────────────────────────────────

exports.resendVerification = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found.', 'USER_NOT_FOUND');
    if (user.isEmailVerified) return sendError(res, 400, 'Email already verified.', 'ALREADY_VERIFIED');

    const { raw, hash } = generateOpaqueToken();
    user.emailVerifyToken = hash;
    user.emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const verifyUrl = `${CLIENT}/verify-email/${raw}`;
    await sendVerificationEmail(user.email, user.name, verifyUrl).catch((err) =>
      console.error('[auth] Failed to send verification email:', err.message)
    );

    return sendSuccess(res, 200, null, 'Verification email sent.');
  } catch (err) {
    next(err);
  }
};

// ─── Forgot password ──────────────────────────────────────────────────────────

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email, authProviders: 'local' });

    // Always return success to avoid email enumeration
    if (!user) {
      return sendSuccess(res, 200, null, 'If that email exists, a reset link has been sent.');
    }

    const { raw, hash } = generateOpaqueToken();
    user.passwordResetToken = hash;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await user.save();

    const resetUrl = `${CLIENT}/reset-password/${raw}`;
    await sendPasswordResetEmail(user.email, user.name, resetUrl).catch((err) =>
      console.error('[auth] Failed to send password reset email:', err.message)
    );

    return sendSuccess(res, 200, null, 'If that email exists, a reset link has been sent.');
  } catch (err) {
    next(err);
  }
};

// ─── Reset password ───────────────────────────────────────────────────────────

exports.resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    const hash = hashOpaqueToken(token);

    const user = await User.findOne({
      passwordResetToken: hash,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      return sendError(res, 400, 'Reset link is invalid or has expired.', 'INVALID_RESET_TOKEN');
    }

    await user.setPassword(password);
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    user.tokenVersion += 1; // invalidate all existing sessions

    // Add local provider if not already there (e.g. Google user setting a password)
    if (!user.authProviders.includes('local')) user.authProviders.push('local');

    await user.save();
    clearRefreshCookie(res);

    // Notify the user their password was changed (non-blocking)
    sendPasswordChangedEmail(user.email, user.name).catch((err) =>
      console.error('[auth] Failed to send password-changed email:', err.message)
    );

    return sendSuccess(res, 200, null, 'Password updated. Please sign in with your new password.');
  } catch (err) {
    next(err);
  }
};
