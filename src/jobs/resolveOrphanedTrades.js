/**
 * jobs/resolveOrphanedTrades.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs on a cron schedule. Finds MT5-sourced trades that remain 'open' longer
 * than ORPHAN_THRESHOLD_HOURS and attempts to auto-close them using market
 * data (Yahoo Finance / Binance) by checking if SL or TP was triggered in
 * historical candle data.
 *
 * Resolution priority:
 *   1. If SL or TP is set → walk candles; auto-close at the first trigger.
 *   2. If no SL/TP (or no trigger found) → flag as 'needs_review' so the
 *      user can close it manually from the dashboard.
 *
 * Auto-resolved trades are tagged 'auto-resolved' and a notification is sent.
 * needs_review trades are tagged 'needs-review'. Both create exactly one
 * notification — subsequent job runs skip already-flagged trades.
 */

'use strict';

const cron         = require('node-cron');
const Trade        = require('../models/Trade');
const Notification = require('../models/Notification');
const { getCandles } = require('../services/marketData');

// ─── Config ───────────────────────────────────────────────────────────────────

/** Hours a metatrader trade must be open before the job considers it orphaned. */
const ORPHAN_THRESHOLD_MS =
  (Number(process.env.ORPHAN_THRESHOLD_HOURS) || 4) * 60 * 60 * 1000;

/**
 * Candle timeframe used for SL/TP scanning.
 * 1h gives hourly resolution — accurate to within one hour for most journalling
 * purposes. Use '1d' if Yahoo rate-limits become a concern.
 */
const CANDLE_TF = process.env.ORPHAN_CANDLE_TF || '1h';

// ─── Core job ─────────────────────────────────────────────────────────────────

async function resolveOrphanedTrades() {
  const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);

  // Only 'open' metatrader trades opened before the cutoff — skip needs_review
  // (already handled) and anything that was recently opened.
  const orphans = await Trade.find({
    source:    'metatrader',
    status:    'open',
    entryDate: { $lt: cutoff },
  }).lean();

  if (!orphans.length) {
    console.log('[orphan-job] No orphaned trades found.');
    return;
  }

  console.log(`[orphan-job] Found ${orphans.length} potentially orphaned trade(s).`);

  for (const trade of orphans) {
    try {
      await processTrade(trade);
    } catch (err) {
      console.error(`[orphan-job] Error processing trade ${trade._id}:`, err.message);
    }
  }
}

// ─── Per-trade resolution ─────────────────────────────────────────────────────

async function processTrade(trade) {
  const hasSl = trade.stopLoss   != null;
  const hasTp = trade.takeProfit != null;

  // ── No SL or TP → can't auto-resolve; flag for manual review ────────────────
  if (!hasSl && !hasTp) {
    await flagForReview(
      trade,
      'No stop loss or take profit recorded — please close or update this trade manually.'
    );
    return;
  }

  // ── Fetch candle history from entry date to now ──────────────────────────────
  const fromMs = new Date(trade.entryDate).getTime();
  const toMs   = Date.now();

  let candles;
  try {
    candles = await getCandles({
      symbol:     trade.symbol,
      assetClass: trade.assetClass,
      timeframe:  CANDLE_TF,
      from:       fromMs,
      to:         toMs,
    });
  } catch (err) {
    console.warn(`[orphan-job] Market data unavailable for ${trade.symbol}: ${err.message}`);
    await flagForReview(
      trade,
      `Could not fetch market data to auto-resolve this trade (${err.message}). Please close it manually.`
    );
    return;
  }

  if (!candles?.length) {
    await flagForReview(
      trade,
      'No market data returned for this symbol — please close this trade manually.'
    );
    return;
  }

  // ── Walk candles chronologically to find first SL/TP hit ────────────────────
  const isLong   = trade.direction === 'long';
  let resolution = null;

  for (const candle of candles) {
    const candleTime = new Date(candle.time * 1000);
    // Skip candles at or before entry — can't close before we opened
    if (candleTime <= new Date(trade.entryDate)) continue;

    // SL check (direction-aware)
    if (hasSl) {
      const slHit = isLong
        ? candle.low  <= trade.stopLoss   // long SL is below entry
        : candle.high >= trade.stopLoss;  // short SL is above entry
      if (slHit) {
        resolution = { price: trade.stopLoss, date: candleTime, reason: 'stop_loss' };
        break;
      }
    }

    // TP check (direction-aware)
    if (hasTp) {
      const tpHit = isLong
        ? candle.high >= trade.takeProfit  // long TP is above entry
        : candle.low  <= trade.takeProfit; // short TP is below entry
      if (tpHit) {
        resolution = { price: trade.takeProfit, date: candleTime, reason: 'take_profit' };
        break;
      }
    }
  }

  // ── No trigger found → still in range or closed manually ────────────────────
  if (!resolution) {
    await flagForReview(
      trade,
      'MetaTrader was offline and no SL/TP trigger was detected in historical candle data. ' +
      'The trade may still be open, or was closed manually / at a custom price. ' +
      'Please update or close this trade manually.'
    );
    return;
  }

  // ── Auto-close the trade ─────────────────────────────────────────────────────
  const label = resolution.reason === 'stop_loss' ? 'SL' : 'TP';
  const note  =
    `[Auto-resolved] ${label} triggered at ${resolution.price} on ` +
    `${resolution.date.toISOString()} while MetaTrader was offline. ` +
    `Candle-level accuracy — verify and adjust if needed.`;

  await Trade.findByIdAndUpdate(
    trade._id,
    {
      exitPrice: resolution.price,
      exitDate:  resolution.date,
      status:    'closed',
      tags:      [...new Set([...(trade.tags || []), 'auto-resolved'])],
      notes:     trade.notes ? `${trade.notes}\n\n${note}` : note,
    },
    { runValidators: true, new: true, context: 'query' }
  );

  await Notification.create({
    userId:  trade.userId,
    type:    'trade_auto_resolved',
    title:   `Trade auto-closed: ${trade.symbol}`,
    body:
      `Your ${trade.symbol} ${trade.direction} trade was auto-closed at ${resolution.price} ` +
      `(${label} triggered) while MetaTrader was offline. ` +
      `Please review — candle-level resolution, actual fill may differ slightly.`,
    linkTo: `/app/trades/${trade._id}`,
  });

  console.log(
    `[orphan-job] Auto-closed trade ${trade._id} ` +
    `(${trade.symbol} ${trade.direction}) via ${resolution.reason} at ${resolution.price}.`
  );
}

// ─── Flag for manual review ───────────────────────────────────────────────────

async function flagForReview(trade, reason) {
  // Don't spam if the job already flagged this trade on a previous run
  if (trade.status === 'needs_review') return;

  const note = `[Needs review] ${reason}`;

  await Trade.findByIdAndUpdate(trade._id, {
    status: 'needs_review',
    tags:   [...new Set([...(trade.tags || []), 'needs-review'])],
    notes:  trade.notes ? `${trade.notes}\n\n${note}` : note,
  });

  await Notification.create({
    userId:  trade.userId,
    type:    'trade_needs_review',
    title:   `Trade needs review: ${trade.symbol}`,
    body:
      `Your ${trade.symbol} ${trade.direction} trade may have closed while MetaTrader was offline. ` +
      reason,
    linkTo: `/app/trades/${trade._id}`,
  });

  console.log(
    `[orphan-job] Flagged trade ${trade._id} (${trade.symbol}) as needs_review.`
  );
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Registers the orphaned-trade resolution cron job.
 * Call once at server startup (from app.js).
 *
 * Default schedule: every 2 hours ('0 *\/2 * * *').
 * Override via env var ORPHAN_RESOLVE_CRON.
 */
function registerOrphanedTradeJob() {
  const schedule = process.env.ORPHAN_RESOLVE_CRON || '0 */2 * * *';

  cron.schedule(schedule, async () => {
    console.log('[cron] Running orphaned trade resolution job…');
    try {
      await resolveOrphanedTrades();
    } catch (err) {
      console.error('[cron] Orphaned trade job failed:', err.message);
    }
  }, { timezone: 'UTC' });

  console.log(`[cron] Orphaned trade resolution scheduled: "${schedule}" (UTC)`);
}

module.exports = { registerOrphanedTradeJob, resolveOrphanedTrades };
