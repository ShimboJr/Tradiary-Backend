/**
 * models/Goal.js
 * A performance goal for a user, tracked against live trade aggregations.
 */
const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, trim: true, maxlength: 100, default: '' },
    type: {
      type: String,
      enum: ['profit_target', 'max_drawdown', 'trade_count', 'win_rate'],
      required: true,
    },
    period: {
      type: String,
      enum: ['weekly', 'monthly'],
      required: true,
    },
    targetValue: {
      type: Number,
      required: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
    isActive: { type: Boolean, default: true },
    startDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Goal', goalSchema);
