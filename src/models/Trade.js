/**
 * models/Trade.js
 * Core trade document. pnl and rMultiple are computed and stored on every save.
 */

const mongoose = require('mongoose');

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const screenshotSchema = new mongoose.Schema(
  {
    url:     { type: String, required: true },
    caption: { type: String, default: '' },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const tradeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },

    symbol: {
      type: String,
      required: [true, 'Symbol is required.'],
      uppercase: true,
      trim: true,
      index: true,
    },

    assetClass: {
      type: String,
      enum: ['stock', 'forex', 'crypto', 'futures', 'options'],
      required: true,
    },

    direction: {
      type: String,
      enum: ['long', 'short'],
      required: true,
    },

    // ── Entry / Exit ─────────────────────────────────────────────────────────

    entryDate:  { type: Date, required: true },
    exitDate:   { type: Date, default: null },

    entryPrice: { type: Number, required: true },
    exitPrice:  { type: Number, default: null },
    quantity:   { type: Number, required: true, min: [0, 'Quantity must be positive.'] },

    // ── Risk management ──────────────────────────────────────────────────────

    stopLoss:   { type: Number, default: null },
    takeProfit: { type: Number, default: null },
    fees:       { type: Number, default: 0, min: 0 },

    // ── Status ───────────────────────────────────────────────────────────────

    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
    },

    // ── Computed fields (stored for fast querying/sorting) ───────────────────

    pnl: {
      type: Number,
      default: null,
    },

    rMultiple: {
      type: Number,
      default: null,
    },

    // ── Strategy & metadata ──────────────────────────────────────────────────

    // Loose ref — Strategy model added in Prompt 04
    strategyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Strategy',
      default: null,
      index: true,
    },

    tags: {
      type: [String],
      default: [],
    },

    emotion: {
      type: String,
      enum: ['confident', 'fearful', 'fomo', 'revenge', 'disciplined', 'neutral', ''],
      default: '',
    },

    executionGrade: {
      type: String,
      enum: ['A', 'B', 'C', 'D', 'F', ''],
      default: '',
    },

    screenshots: {
      type: [screenshotSchema],
      default: [],
    },

    notes: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// ─── Compound indexes for common queries ─────────────────────────────────────

tradeSchema.index({ userId: 1, entryDate: -1 });
tradeSchema.index({ userId: 1, symbol: 1 });
tradeSchema.index({ userId: 1, status: 1 });

// ─── Pre-save: compute pnl + rMultiple ───────────────────────────────────────

tradeSchema.pre('save', function (next) {
  computeMetrics(this);
  next();
});

// Also fires on findOneAndUpdate with { runValidators, new, context:'query' }
tradeSchema.pre('findOneAndUpdate', function (next) {
  computeMetrics(this._update?.$set || this._update || {});
  next();
});

function computeMetrics(doc) {
  // pnl: only computable when trade is closed
  if (doc.exitPrice != null && doc.entryPrice != null && doc.quantity != null) {
    const raw =
      doc.direction === 'short'
        ? (doc.entryPrice - doc.exitPrice) * doc.quantity
        : (doc.exitPrice - doc.entryPrice) * doc.quantity;
    doc.pnl = parseFloat((raw - (doc.fees || 0)).toFixed(6));
    doc.status = 'closed';
  } else {
    doc.pnl = null;
    if (!doc.exitPrice) doc.status = doc.status || 'open';
  }

  // rMultiple: realized result in terms of initial risk per unit
  if (
    doc.pnl != null &&
    doc.stopLoss != null &&
    doc.entryPrice != null &&
    doc.quantity != null
  ) {
    const riskPerUnit = Math.abs(doc.entryPrice - doc.stopLoss);
    if (riskPerUnit > 0) {
      const totalRisk = riskPerUnit * doc.quantity;
      doc.rMultiple = parseFloat((doc.pnl / totalRisk).toFixed(3));
    }
  } else {
    doc.rMultiple = null;
  }
}

const Trade = mongoose.model('Trade', tradeSchema);
module.exports = Trade;
