/**
 * controllers/replayController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /api/trades/:id/replay-data
 *
 * Loads the trade, picks the best candle timeframe, applies a 20% padding
 * window, fetches via the cache layer, and returns candles + markers.
 *
 * On any market-data failure the endpoint returns 200 with
 * { available: false, reason: "…" } — the frontend shows a graceful
 * "Replay not available" state instead of an error.
 *
 * Yahoo Finance intraday data age limits
 * ──────────────────────────────────────
 *   1m  → last  7 days only
 *   5m  → last 60 days only
 *   1h  → last 730 days only
 *   1d  → full history
 *
 * We automatically downgrade the timeframe if the trade is too old for the
 * originally chosen resolution, cascading until 1d which is always available.
 */

'use strict';

const { Trade }            = require('../models');
const { getCandlesCached } = require('../services/marketDataCache');

// ─── Timeframe selection ──────────────────────────────────────────────────────

/**
 * Pick candle resolution from trade duration (ideal, ignoring data age).
 *   < 2 h  → 1m
 *   < 1 d  → 5m
 *   < 1 wk → 1h
 *   ≥ 1 wk → 1d
 */
function pickTimeframe(entryDate, exitDate) {
  const ms = new Date(exitDate) - new Date(entryDate);
  const h  = 3_600_000;
  const d  = h * 24;
  const wk = d * 7;
  if (ms < 2 * h) return '1m';
  if (ms < d)      return '5m';
  if (ms < wk)     return '1h';
  return '1d';
}

/**
 * Yahoo Finance intraday limits (days back from now).
 * If the trade entry is older than this, the timeframe can't be used.
 */
const YAHOO_MAX_AGE_DAYS = {
  '1m':  7,
  '5m':  60,
  '15m': 60,
  '1h':  730,
  '1d':  Infinity,
};

/**
 * Waterfall: downgrade the timeframe until one that Yahoo can actually serve
 * for this trade's age. Returns the adjusted timeframe and a flag if it
 * changed.
 */
function adjustTimeframeForAge(timeframe, entryDate) {
  const ageDays = (Date.now() - new Date(entryDate).getTime()) / 86_400_000;
  const cascade = ['1m', '5m', '1h', '1d'];
  let tf = timeframe;
  for (const candidate of cascade.slice(cascade.indexOf(timeframe))) {
    if (ageDays <= YAHOO_MAX_AGE_DAYS[candidate]) return candidate;
  }
  return '1d'; // always safe fallback
}

// ─── Window calculation ───────────────────────────────────────────────────────

/**
 * Pad the trade window by 20% on each side (minimum 10 candle periods).
 */
function paddedWindow(entryDate, exitDate, timeframe) {
  const entry = new Date(entryDate).getTime();
  const exit  = new Date(exitDate).getTime();
  const dur   = exit - entry;
  const tfMs  = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '1d': 86_400_000 };
  const pad   = Math.max(dur * 0.20, (tfMs[timeframe] || 60_000) * 10);
  return { from: entry - pad, to: exit + pad };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function getReplayData(req, res) {
  try {
    const { id } = req.params;

    const trade = await Trade.findOne({ _id: id, userId: req.user.id }).lean();
    if (!trade) {
      return res.status(404).json({
        success: false,
        error: { message: 'Trade not found.', code: 'NOT_FOUND' },
      });
    }

    // Replay only makes sense for closed trades
    if (trade.status !== 'closed' || !trade.exitDate || !trade.exitPrice) {
      return res.json({ available: false, reason: 'Replay is only available for closed trades with an exit price and date.' });
    }

    // Pick ideal timeframe then downgrade if the trade is too old
    const ideal     = pickTimeframe(trade.entryDate, trade.exitDate);
    const timeframe = adjustTimeframeForAge(ideal, trade.entryDate);

    const { from, to } = paddedWindow(trade.entryDate, trade.exitDate, timeframe);

    // Fetch candles via cache
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
      return res.json({ available: false, reason: `Market data unavailable for ${trade.symbol}: ${err.message}` });
    }

    if (!candles || candles.length === 0) {
      return res.json({
        available: false,
        reason: `No candle data returned for ${trade.symbol} at ${timeframe}. ` +
                'The symbol may not be recognised by the data provider, or the trade dates are outside the available history.',
      });
    }

    // Build markers
    const entryTime = snapToCandle(trade.entryDate, timeframe);
    const exitTime  = snapToCandle(trade.exitDate,  timeframe);

    const markers = {
      entry: { time: entryTime, price: trade.entryPrice },
      exit:  { time: exitTime,  price: trade.exitPrice  },
    };
    if (trade.stopLoss   != null) markers.stopLoss   = trade.stopLoss;
    if (trade.takeProfit != null) markers.takeProfit = trade.takeProfit;

    return res.json({ available: true, timeframe, candles, markers });

  } catch (err) {
    console.error('[replay] Unexpected error:', err);
    return res.json({ available: false, reason: 'An unexpected error occurred while loading replay data.' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snapToCandle(date, timeframe) {
  const periodS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 }[timeframe] || 60;
  const ts = Math.floor(new Date(date).getTime() / 1000);
  return ts - (ts % periodS);
}

module.exports = { getReplayData };
