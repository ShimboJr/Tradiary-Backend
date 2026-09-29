/**
 * models/WatchlistItem.js
 * Manual watchlist — no live price feed, journaling tool only.
 */
const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    symbol:      { type: String, required: true, uppercase: true, trim: true },
    notes:       { type: String, default: '' },
    targetEntry: { type: Number, default: null },
    targetStop:  { type: Number, default: null },
    direction:   { type: String, enum: ['long', 'short', ''], default: '' },
    priority:    { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WatchlistItem', watchlistSchema);
