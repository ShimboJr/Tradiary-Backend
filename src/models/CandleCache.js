/**
 * models/CandleCache.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Stores fetched candle windows so repeated replay views don't re-hit the
 * market-data provider. Historical candles never change once the period
 * has closed, so we cache aggressively.
 *
 * Strategy:
 *   • One document per (symbol, timeframe, periodStart, periodEnd) window.
 *   • getCandles() in marketDataCache.js checks for an existing document
 *     that covers the requested range before calling the provider.
 *   • Only the gap (if any) is fetched and merged in.
 *   • TTL: 30 days — old entries are pruned automatically via the
 *     fetchedAt index below.
 */

'use strict';

const mongoose = require('mongoose');

const candleCacheSchema = new mongoose.Schema(
  {
    symbol:      { type: String,  required: true, uppercase: true, trim: true },
    timeframe:   { type: String,  required: true },   // '1m' | '5m' | '15m' | '1h' | '1d'
    periodStart: { type: Number,  required: true },   // Unix seconds (inclusive)
    periodEnd:   { type: Number,  required: true },   // Unix seconds (inclusive)
    candles:     { type: [mongoose.Schema.Types.Mixed], default: [] }, // [{time,o,h,l,c}]
    fetchedAt:   { type: Date,    default: Date.now },
  },
  { timestamps: false }
);

// Fast lookup by symbol + timeframe; fetchedAt for TTL scanning
candleCacheSchema.index({ symbol: 1, timeframe: 1, periodStart: 1, periodEnd: 1 });
// Auto-expire documents after 30 days (seconds)
candleCacheSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const CandleCache = mongoose.model('CandleCache', candleCacheSchema);
module.exports = CandleCache;
