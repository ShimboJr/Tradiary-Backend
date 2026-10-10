/**
 * models/User.js
 * Tradiary user document.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required.'],
      trim: true,
      maxlength: [80, 'Name cannot exceed 80 characters.'],
    },

    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address.'],
    },

    // null for Google-only accounts
    passwordHash: {
      type: String,
      default: null,
    },

    // Allows a single email to use both local + google
    authProviders: {
      type: [{ type: String, enum: ['local', 'google'] }],
      default: [],
    },

    // Sparse so multiple null values are allowed (only one googleId per row)
    googleId: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },

    avatarUrl: {
      type: String,
      default: null,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    // Signed token stored as hash for email verification
    emailVerifyToken: { type: String, default: null },
    emailVerifyExpires: { type: Date, default: null },

    // Password reset
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },

    // Brute-force protection
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },

    // Incrementing this invalidates all existing refresh tokens globally
    tokenVersion: { type: Number, default: 0 },

    // User preferences
    timezone: { type: String, default: 'UTC' },
    baseCurrency: { type: String, default: 'USD', uppercase: true, trim: true },
    theme: { type: String, enum: ['dark', 'light'], default: 'light' },

    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt
  }
);

// ─── Virtuals ────────────────────────────────────────────────────────────────

/** True if the account is currently locked out */
userSchema.virtual('isLocked').get(function () {
  return this.lockUntil && this.lockUntil > Date.now();
});

// ─── Instance Methods ────────────────────────────────────────────────────────

/**
 * Hash and set password.
 * @param {string} plainPassword
 */
userSchema.methods.setPassword = async function (plainPassword) {
  this.passwordHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
};

/**
 * Verify a plaintext password against the stored hash.
 * @param {string} plainPassword
 * @returns {Promise<boolean>}
 */
userSchema.methods.verifyPassword = async function (plainPassword) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plainPassword, this.passwordHash);
};

/**
 * Record a failed login attempt. Locks the account for 15 min after 5 failures.
 */
userSchema.methods.recordFailedLogin = async function () {
  const WINDOW_MS = 10 * 60 * 1000;  // 10 minute window
  const MAX_ATTEMPTS = 5;
  const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minute lockout

  // If the lock has expired, reset the counter
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.failedLoginAttempts = 0;
    this.lockUntil = null;
  }

  this.failedLoginAttempts += 1;

  if (this.failedLoginAttempts >= MAX_ATTEMPTS) {
    this.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
    this.failedLoginAttempts = 0; // reset so next window starts fresh after unlock
  }

  await this.save();
};

/** Reset failed-login tracking on successful login. */
userSchema.methods.resetLoginAttempts = async function () {
  if (this.failedLoginAttempts !== 0 || this.lockUntil !== null) {
    this.failedLoginAttempts = 0;
    this.lockUntil = null;
    await this.save();
  }
};

/**
 * Increment tokenVersion to globally invalidate all refresh tokens.
 */
userSchema.methods.invalidateTokens = async function () {
  this.tokenVersion += 1;
  await this.save();
};

// ─── toJSON sanitiser ─────────────────────────────────────────────────────────
// Strip sensitive fields before any JSON serialisation

userSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.passwordHash;
  delete obj.emailVerifyToken;
  delete obj.emailVerifyExpires;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  delete obj.failedLoginAttempts;
  delete obj.lockUntil;
  delete obj.tokenVersion;
  delete obj.__v;
  return obj;
};

const User = mongoose.model('User', userSchema);
module.exports = User;
