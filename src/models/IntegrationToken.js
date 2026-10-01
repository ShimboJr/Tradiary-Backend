/**
 * models/IntegrationToken.js
 * Stores hashed API tokens for EA (MetaTrader) webhook auth.
 * Raw tokens are never stored — only a SHA-256 hash.
 */

const mongoose = require('mongoose');

const integrationTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // SHA-256 hex of the raw token. Indexed for fast lookup on every webhook call.
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Human-readable label, e.g. "MT5 — Main Account"
    label: {
      type: String,
      required: true,
      trim: true,
      default: 'MetaTrader Terminal',
    },

    // Set to null while active; set to a Date when revoked.
    revokedAt: {
      type: Date,
      default: null,
    },

    // Updated on every successful webhook call — powers the "Last trade received" UI.
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

integrationTokenSchema.index({ userId: 1, revokedAt: 1 });

const IntegrationToken = mongoose.model('IntegrationToken', integrationTokenSchema);
module.exports = IntegrationToken;
