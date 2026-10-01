/**
 * controllers/replayController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /api/trades/:id/replay-data[?timeframe=5m]
 *
 * Returns candle data + markers for the Trade Replay view.
 *
 * Timeframe selection
 * ───────────────────
 * 1. If the caller passes ?timeframe=X and that TF is within Yahoo's data age
 *    limit, use it directly.
 * 2. Otherwise pick the "ideal" TF for the trade duration then cascade down
 *    until one that Yahoo can serve.
 *
 * Window calculation
 * ──────────────────
 * We show CONTEXT_BEFORE candles before the entry and CONTEXT_AFTER candles
 * after the exit — giving the trader meaningful price action context around
 * their trade, not just a clipped view.
 *
 * Yahoo Finance intraday data age limits
 * ──────────────────────────────────────
 *   1m       → last  7 days
 *   5m/15m/30m → last 60 days
 *   1h       → last 730 days
 *   1d       → full history
 *
 * Response shape
 * ──────────────
 *   {
 *     available: true,
 *     timeframe: "5m",
 *     availableTimeframes: [
 *       { value: "1m",  available: true,  label: "1m"  },
 *       { value: "5m",  available: true,  label: "5m"  },
 *       ...
 *     ],
 *     candles: [{ time, open, high, low, close }, ...],
 *     markers: { entry, exit, stopLoss?, takeProfit? }
 *   }
 *
 * On any data failure returns { available: false, reason: "..." } — frontend
 * shows a graceful state instead of crashing.
 */

'use strict';

const { Trade }            = require('../models');
const { getCandlesCached } = require('../services/marketDataCache');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Candles of price action to show before the entry */
const CONTEXT_BEFORE = 50;

/** Candles of price action to show after the exit */
const CONTEXT_AFTER  = 20;

/** All timeframes we expose to the frontend, in ascending granularity order */
const ALL_TIMEFRAMES = [
  { value: '1m',  label: '1m'  },
  { value: '5m',  label: '5m'  },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h',  label: '1h'  },
  { value: '1d',  label: '1d'  },
];

/** Yahoo Finance maximum data age in days for intraday resolutions */
const YAHOO_MAX_AGE_DAYS = {
  '1m':  7,
  '5m':  60,
  '15m': 60,
  '30m': 60,
  '1h':  730,
  '1d':  Infinity,
};

/** Milliseconds per candle */
const TF_MS = {
  '1m':  60_000,
  '5m':  300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h':  3_600_000,
  '1d':  86_400_000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pick the "ideal" default timeframe for a trade duration.
 *   < 2 h  → 1m
 *   < 1 d  → 5m
 *   < 1 wk → 1h
 *   ≥ 1 wk → 1d
 */
function pickDefaultTimeframe(entryDate, exitDate) {
  const ms = new Date(exitDate) - new Date(entryDate);
  const h = 3_600_000, d = h * 24, wk = d * 7;
  if (ms < 2 * h) return '1m';
  if (ms < d)     return '5m';
  if (ms < wk)    return '1h';
  return '1d';
}

/**
 * Build the list of available/unavailable timeframes based on trade age.
 */
function buildAvailableTimeframes(entryDate) {
  const ageDays = (Date.now() - new Date(entryDate).getTime()) / 86_400_000;
  return ALL_TIMEFRAMES.map(({ value, label }) => ({
    value,
    label,
    available: ageDays <= (YAHOO_MAX_AGE_DAYS[value] ?? 0),
  }));
}

/**
 * Starting from `timeframe`, cascade to longer resolutions until we find one
 * that Yahoo can actually serve for this trade's age.
 */
function adjustTimeframeForAge(timeframe, entryDate) {
  const ageDays = (Date.now() - new Date(entryDate).getTime()) / 86_400_000;
  const order   = ALL_TIMEFRAMES.map(t => t.value);
  for (const tf of order.slice(order.indexOf(timeframe))) {
    if (ageDays <= (YAHOO_MAX_AGE_DAYS[tf] ?? 0)) return tf;
  }
  return '1d';
}

/**
 * Calculate fetch window: CONTEXT_BEFORE candles before entry +
 * trade duration + CONTEXT_AFTER candles after exit.
 */
function buildWindow(entryDate, exitDate, timeframe) {
  const entry = new Date(entryDate).getTime();
  const exit  = new Date(exitDate).getTime();
  const ms    = TF_MS[timeframe] ?? TF_MS['5m'];
  return {
    from: entry - CONTEXT_BEFORE * ms,
    to:   exit  + CONTEXT_AFTER  * ms,
  };
}

/** Snap a date to the nearest candle boundary for that timeframe */
function snapToCandle(date, timeframe) {
  const periodS = (TF_MS[timeframe] ?? TF_MS['5m']) / 1000;
  const ts      = Math.floor(new Date(date).getTime() / 1000);
  return ts - (ts % periodS);
}

// ─── Controller ───────────────────────────────────────────────────────────────

async function getReplayData(req, res) {
  try {
    const { id }  = req.params;
    const reqTf   = req.query.timeframe; // optional override from frontend

    const trade = await Trade.findOne({ _id: id, userId: req.user.id }).lean();
    if (!trade) {
      return res.status(404).json({
        success: false,
        error: { message: 'Trade not found.', code: 'NOT_FOUND' },
      });
    }

    // Replay only makes sense for closed trades
    if (trade.status !== 'closed' || !trade.exitDate || !trade.exitPrice) {
      return res.json({
        available: false,
        reason: 'Replay is only available for closed trades with an exit price and date.',
      });
    }

    const availableTimeframes = buildAvailableTimeframes(trade.entryDate);

    // Resolve which timeframe to actually use
    let timeframe;
    const validValues = ALL_TIMEFRAMES.map(t => t.value);

    if (reqTf && validValues.includes(reqTf)) {
      const tfInfo = availableTimeframes.find(t => t.value === reqTf);
      if (tfInfo?.available) {
        timeframe = reqTf;
      } else {
        // Requested TF not available for this trade's age — cascade down
        timeframe = adjustTimeframeForAge(reqTf, trade.entryDate);
        console.warn(`[replay] Requested TF ${reqTf} too old; using ${timeframe} instead`);
      }
    } else {
      // Auto-select
      const ideal = pickDefaultTimeframe(trade.entryDate, trade.exitDate);
      timeframe   = adjustTimeframeForAge(ideal, trade.entryDate);
    }

    const { from, to } = buildWindow(trade.entryDate, trade.exitDate, timeframe);

    // Fetch candles via cache layer
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
      console.warn(`[replay] Market data fetch failed for ${trade.symbol}@${timeframe}: ${err.message}`);
      return res.json({
        available: false,
        reason: `Market data unavailable for ${trade.symbol}: ${err.message}`,
        availableTimeframes,
      });
    }

    if (!candles || candles.length === 0) {
      return res.json({
        available: false,
        reason:
          `No candle data returned for ${trade.symbol} at ${timeframe}. ` +
          'The symbol may not be recognised by the data provider, or the requested period is outside available history.',
        availableTimeframes,
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

    // Index of the entry and exit candles (used by frontend for jump buttons)
    const entryIdx = candles.findIndex(c => c.time >= entryTime);
    const exitIdx  = candles.findIndex(c => c.time >= exitTime);

    return res.json({
      available: true,
      timeframe,
      availableTimeframes,
      candles,
      markers,
      entryIdx: entryIdx >= 0 ? entryIdx : 0,
      exitIdx:  exitIdx  >= 0 ? exitIdx  : candles.length - 1,
    });

  } catch (err) {
    console.error('[replay] Unexpected error:', err);
    return res.json({ available: false, reason: 'An unexpected error occurred while loading replay data.' });
  }
}

module.exports = { getReplayData };
