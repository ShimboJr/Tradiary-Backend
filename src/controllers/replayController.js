/**
 * controllers/replayController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /api/trades/:id/replay-data
 *
 * Loads the trade, picks an appropriate candle timeframe based on duration,
 * pads the window by 20% on each side, fetches candles via the cache layer,
 * and returns markers for entry / exit / SL / TP.
 *
 * On any market-data failure the endpoint returns 200 with
 * { available: false, reason: "…" } so the frontend can show a graceful
 * "Replay not available" state instead of crashing.
 */

'use strict';

const { Trade }              = require('../models');
const { getCandlesCached }   = require('../services/marketDataCache');

// ─── Timeframe selection ──────────────────────────────────────────────────────

/**
 * Choose an appropriate candle resolution based on trade duration.
 * Returns our canonical timeframe string.
 *
 * < 2 h  → 1m
 * < 1 d  → 5m
 * < 1 wk → 1h
 * ≥ 1 wk → 1d
 */
function pickTimeframe(entryDate, exitDate) {
  const durationMs = new Date(exitDate) - new Date(entryDate);
  const h  = 1000 * 60 * 60;
  const d  = h * 24;
  const wk = d * 7;

  if (durationMs < 2 * h)  return '1m';
  if (durationMs < d)       return '5m';
  if (durationMs < wk)      return '1h';
  return '1d';
}

/**
 * Compute a padded window around the trade. Padding = 20% of duration on
 * each side, with a minimum of 5 candles-worth of padding so very short
 * trades still have some context.
 */
function paddedWindow(entryDate, exitDate, timeframe) {
  const entry      = new Date(entryDate).getTime();
  const exit       = new Date(exitDate).getTime();
  const durationMs = exit - entry;

  // Padding: 20% of duration, minimum 10 candle periods
  const tfMs = {
    '1m':  60_000,
    '5m':  300_000,
    '15m': 900_000,
    '1h':  3_600_000,
    '1d':  86_400_000,
  };
  const minPad = (tfMs[timeframe] || 60_000) * 10;
  const pad    = Math.max(durationMs * 0.20, minPad);

  return {
    from: entry - pad,
    to:   exit  + pad,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function getReplayData(req, res) {
  try {
    const { id } = req.params;

    // ── Load trade ─────────────────────────────────────────────────────────
    const trade = await Trade.findOne({ _id: id, userId: req.user.id }).lean();
    if (!trade) {
      return res.status(404).json({
        success: false,
        error: { message: 'Trade not found.', code: 'NOT_FOUND' },
      });
    }

    // ── Replay only makes sense for closed trades ──────────────────────────
    if (trade.status !== 'closed' || !trade.exitDate || !trade.exitPrice) {
      return res.status(200).json({
        available: false,
        reason:    'Replay is only available for closed trades.',
      });
    }

    // ── Pick timeframe + window ────────────────────────────────────────────
    const timeframe = pickTimeframe(trade.entryDate, trade.exitDate);
    const { from, to } = paddedWindow(trade.entryDate, trade.exitDate, timeframe);

    // ── Fetch candles (via cache) ──────────────────────────────────────────
    let candles;
    try {
      candles = await getCandlesCached({
        symbol:     trade.symbol,
        assetClass: trade.assetClass,
        timeframe,
        from,
        to,
      });
    } catch (err) {
      console.warn(`[replay] Market data fetch failed for ${trade.symbol}: ${err.message}`);
      return res.status(200).json({
        available: false,
        reason: `Market data unavailable for ${trade.symbol}: ${err.message}`,
      });
    }

    if (!candles || candles.length === 0) {
      return res.status(200).json({
        available: false,
        reason: `No candle data returned for ${trade.symbol} at ${timeframe} resolution. ` +
                'The symbol may not be supported by the data provider.',
      });
    }

    // ── Build markers ─────────────────────────────────────────────────────
    // Snap entry/exit times to the nearest candle boundary
    const entryTime = snapToCandle(trade.entryDate, timeframe);
    const exitTime  = snapToCandle(trade.exitDate,  timeframe);

    const markers = {
      entry: { time: entryTime, price: trade.entryPrice },
      exit:  { time: exitTime,  price: trade.exitPrice  },
    };
    if (trade.stopLoss   != null) markers.stopLoss   = trade.stopLoss;
    if (trade.takeProfit != null) markers.takeProfit = trade.takeProfit;

    return res.status(200).json({
      available: true,
      timeframe,
      candles,
      markers,
    });

  } catch (err) {
    console.error('[replay] Unexpected error:', err);
    // Always return graceful JSON, never a 500 that breaks the frontend
    return res.status(200).json({
      available: false,
      reason: 'An unexpected error occurred while loading replay data.',
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Snap a date to the floor of the candle period (Unix seconds).
 * This ensures entry/exit markers align with a candle's open time.
 */
function snapToCandle(date, timeframe) {
  const periodS = {
    '1m':  60,
    '5m':  300,
    '15m': 900,
    '1h':  3600,
    '1d':  86400,
  }[timeframe] || 60;

  const ts = Math.floor(new Date(date).getTime() / 1000);
  return ts - (ts % periodS);
}

module.exports = { getReplayData };
