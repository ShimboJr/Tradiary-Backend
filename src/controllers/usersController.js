/**
 * controllers/usersController.js
 * Profile update, password management, data export, and account deletion.
 */

const User    = require('../models/User');
const Trade   = require('../models/Trade');
const { sendSuccess, sendError } = require('../utils/response');

// ── Update profile ────────────────────────────────────────────────────────────
exports.updateProfile = async (req, res, next) => {
  try {
    const allowed = ['name', 'timezone', 'baseCurrency', 'theme'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!user) return sendError(res, 404, 'User not found.', 'NOT_FOUND');

    return sendSuccess(res, 200, user, 'Profile updated.');
  } catch (err) {
    next(err);
  }
};

// ── Change password (local accounts) ─────────────────────────────────────────
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return sendError(res, 400, 'currentPassword and newPassword are required.', 'VALIDATION_ERROR');
    }

    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found.', 'NOT_FOUND');

    if (!user.authProviders.includes('local')) {
      return sendError(res, 400, 'This account does not use a local password.', 'INVALID_OPERATION');
    }

    const valid = await user.verifyPassword(currentPassword);
    if (!valid) return sendError(res, 401, 'Current password is incorrect.', 'INVALID_PASSWORD');

    if (newPassword.length < 8) {
      return sendError(res, 400, 'New password must be at least 8 characters.', 'VALIDATION_ERROR');
    }

    await user.setPassword(newPassword);
    // Invalidate all refresh tokens
    user.tokenVersion += 1;
    await user.save();

    return sendSuccess(res, 200, null, 'Password changed successfully.');
  } catch (err) {
    next(err);
  }
};

// ── Set password (Google-only accounts adding local auth) ─────────────────────
exports.setPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return sendError(res, 400, 'Password must be at least 8 characters.', 'VALIDATION_ERROR');
    }

    const user = await User.findById(req.user.id);
    if (!user) return sendError(res, 404, 'User not found.', 'NOT_FOUND');

    if (user.authProviders.includes('local')) {
      return sendError(res, 400, 'Use change-password to update an existing password.', 'INVALID_OPERATION');
    }

    await user.setPassword(newPassword);
    if (!user.authProviders.includes('local')) {
      user.authProviders.push('local');
    }
    await user.save();

    return sendSuccess(res, 200, null, 'Password set. You can now sign in with email and password.');
  } catch (err) {
    next(err);
  }
};

// ── Export all data ───────────────────────────────────────────────────────────
exports.exportData = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user   = await User.findById(userId).lean();
    if (!user) return sendError(res, 404, 'User not found.', 'NOT_FOUND');

    // Gather all collections for this user
    const JournalEntry  = require('../models/JournalEntry');
    const Strategy      = require('../models/Strategy');
    const Goal          = require('../models/Goal');
    const Account       = require('../models/Account');
    const WatchlistItem = require('../models/WatchlistItem');

    const [trades, journal, strategies, goals, accounts, watchlist] = await Promise.all([
      Trade.find({ userId }).lean(),
      JournalEntry.find({ userId }).lean(),
      Strategy.find({ userId }).lean(),
      Goal.find({ userId }).lean(),
      Account.find({ userId }).lean(),
      WatchlistItem.find({ userId }).lean(),
    ]);

    // Strip sensitive user fields
    delete user.passwordHash;
    delete user.emailVerifyToken;
    delete user.passwordResetToken;
    delete user.tokenVersion;
    delete user.failedLoginAttempts;
    delete user.lockUntil;

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      user,
      trades,
      journal,
      strategies,
      goals,
      accounts,
      watchlist,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="tradiary-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.status(200).json(exportPayload);
  } catch (err) {
    next(err);
  }
};

// ── Delete account (GDPR — full cascade) ─────────────────────────────────────
exports.deleteAccount = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Import all models for cascade delete
    const JournalEntry   = require('../models/JournalEntry');
    const Strategy       = require('../models/Strategy');
    const Goal           = require('../models/Goal');
    const Account        = require('../models/Account');
    const WatchlistItem  = require('../models/WatchlistItem');
    const Notification   = require('../models/Notification');

    await Promise.all([
      Trade.deleteMany({ userId }),
      JournalEntry.deleteMany({ userId }),
      Strategy.deleteMany({ userId }),
      Goal.deleteMany({ userId }),
      Account.deleteMany({ userId }),
      WatchlistItem.deleteMany({ userId }),
      Notification.deleteMany({ userId }),
    ]);

    await User.findByIdAndDelete(userId);

    // Clear refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    return sendSuccess(res, 200, null, 'Account and all data permanently deleted.');
  } catch (err) {
    next(err);
  }
};
