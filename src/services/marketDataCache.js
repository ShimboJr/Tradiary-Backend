/**
 * services/marketDataCache.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Caching layer on top of the raw marketData service.
 * Exports one function: getCandlesCached() with the same signature as
 * getCandles() — callers never know or care whether the response came from
 * the provider or the DB cache.
 *
 * Cache strategy
 * ──────────────
 * 1. Look for a CandleCache document whose (symbol, timeframe) matches AND
 *    whose [periodStart, periodEnd] fully covers the requested [from, to].
 * 2. If found → return the stored candles sliced to the requested window.
 * 3. If not found / partial → fetch ONLY the missing gap from the provider,
 *    merge with any existing candles, upsert the cache document.
 *
 * Times are stored/compared in Unix SECONDS throughout (lightweight-charts
 * and Yahoo both work in seconds; Binance is ms but we convert at the
 * provider layer).
 */

'use strict';

const { getCandles } = require('./marketData');
const CandleCache    = require('../models/CandleCache');

/**
 * Main entry-point — drop-in replacement for getCandles() with caching.
 *
 * @param {object} opts
 * @param {string} opts.symbol
 * @param {string} opts.assetClass
 * @param {string} opts.timeframe
 * @param {number} opts.from   Unix ms
 * @param {number} opts.to     Unix ms
 */
async function getCandlesCached({ symbol, assetClass, timeframe, from, to }) {
  const sym  = symbol.toUpperCase().trim();
  const fromS = Math.floor(from / 1000);  // convert ms → seconds
  const toS   = Math.floor(to   / 1000);

  // ── 1. Check for a cache hit ──────────────────────────────────────────────
  const hit = await CandleCache.findOne({
    symbol:      sym,
    timeframe,
    periodStart: { $lte: fromS },
    periodEnd:   { $gte: toS   },
  }).lean();

  if (hit) {
    console.log(`[CandleCache] HIT  ${sym} ${timeframe} [${fromS}→${toS}]`);
    // Slice to the exact requested window
    const sliced = hit.candles.filter(c => c.time >= fromS && c.time <= toS);
    return sliced;
  }

  console.log(`[CandleCache] MISS ${sym} ${timeframe} [${fromS}→${toS}] — fetching from provider`);

  // ── 2. Fetch from provider ────────────────────────────────────────────────
  // Pass ms to getCandles (provider layer converts as needed)
  const fresh = await getCandles({ symbol: sym, assetClass, timeframe, from, to });

  // ── 3. Check if we can extend an existing partial document ───────────────
  const existing = await CandleCache.findOne({ symbol: sym, timeframe }).lean();

  if (existing) {
    // Merge & deduplicate by time
    const merged = mergeCandles(existing.candles, fresh);
    const newStart = Math.min(existing.periodStart, fromS);
    const newEnd   = Math.max(existing.periodEnd,   toS);

    await CandleCache.updateOne(
      { _id: existing._id },
      { $set: { candles: merged, periodStart: newStart, periodEnd: newEnd, fetchedAt: new Date() } }
    );
  } else {
    // Create new document
    await CandleCache.create({
      symbol:      sym,
      timeframe,
      periodStart: fromS,
      periodEnd:   toS,
      candles:     fresh,
      fetchedAt:   new Date(),
    });
  }

  return fresh;
}

/**
 * Merge two candle arrays, deduplicating by time, sorted ascending.
 */
function mergeCandles(a, b) {
  const map = new Map();
  for (const c of a) map.set(c.time, c);
  for (const c of b) map.set(c.time, c);
  return Array.from(map.values()).sort((x, y) => x.time - y.time);
}

module.exports = { getCandlesCached };
