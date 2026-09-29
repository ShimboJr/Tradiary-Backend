/**
 * controllers/analyticsController.js
 * GET /api/analytics/summary
 * All heavy computation done in MongoDB aggregation pipelines.
 * Time-sequential computations (streaks, drawdown, equity curve) done server-side in Node.
 */

const mongoose = require('mongoose');
const Trade    = require('../models/Trade');
const { sendSuccess } = require('../utils/response');

// ─── Filter builder (same logic as tradeController) ──────────────────────────

function buildFilter(userId, q) {
  const f = { userId: new mongoose.Types.ObjectId(userId), status: 'closed' };
  if (q.accountId  && mongoose.isValidObjectId(q.accountId))  f.accountId  = new mongoose.Types.ObjectId(q.accountId);
  if (q.strategyId && mongoose.isValidObjectId(q.strategyId)) f.strategyId = new mongoose.Types.ObjectId(q.strategyId);
  if (q.symbol)  f.symbol = q.symbol.toUpperCase();
  if (q.tags)    f.tags   = { $in: Array.isArray(q.tags) ? q.tags : q.tags.split(',') };
  if (q.dateFrom || q.dateTo) {
    f.entryDate = {};
    if (q.dateFrom) f.entryDate.$gte = new Date(q.dateFrom);
    if (q.dateTo)   f.entryDate.$lte = new Date(new Date(q.dateTo).setHours(23, 59, 59, 999));
  }
  return f;
}

// ─── R-multiple bucket expression ─────────────────────────────────────────────

const rBucketExpr = {
  $switch: {
    branches: [
      { case: { $lte: ['$rMultiple', -2] },                                               then: '<-2R'      },
      { case: { $and: [{ $gt: ['$rMultiple', -2] }, { $lte: ['$rMultiple', -1] }] },      then: '-2R to -1R' },
      { case: { $and: [{ $gt: ['$rMultiple', -1] }, { $lt:  ['$rMultiple',  0] }] },      then: '-1R to 0R'  },
      { case: { $and: [{ $gte: ['$rMultiple',  0] }, { $lt:  ['$rMultiple',  1] }] },     then: '0R to 1R'   },
      { case: { $and: [{ $gte: ['$rMultiple',  1] }, { $lt:  ['$rMultiple',  2] }] },     then: '1R to 2R'   },
      { case: { $gte:  ['$rMultiple', 2] },                                               then: '>2R'        },
    ],
    default: 'other',
  },
};

const R_ORDER = ['<-2R', '-2R to -1R', '-1R to 0R', '0R to 1R', '1R to 2R', '>2R'];

const DOW_MAP = { 1: 'Sun', 2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu', 6: 'Fri', 7: 'Sat' };

// ─── Main handler ─────────────────────────────────────────────────────────────

exports.summary = async (req, res, next) => {
  try {
    const filter = buildFilter(req.user.id, req.query);

    // Determine period granularity from date range
    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom) : null;
    const dateTo   = req.query.dateTo   ? new Date(req.query.dateTo)   : new Date();
    let dateFormat = '%Y-%m-%d'; // daily
    let granularity = 'day';
    if (dateFrom) {
      const days = (dateTo - dateFrom) / 86_400_000;
      if (days > 180) { dateFormat = '%Y-%m'; granularity = 'month'; }
      else if (days > 31) { dateFormat = '%G-W%V'; granularity = 'week'; }
    }

    // ── Run aggregation + time-series fetch in parallel ──────────────────────
    const [facetResult, timeSeries] = await Promise.all([

      Trade.aggregate([
        { $match: filter },
        {
          $facet: {
            // ── Core metrics ──────────────────────────────────────────────
            coreStats: [
              {
                $group: {
                  _id: null,
                  totalTrades: { $sum: 1 },
                  netPnl:      { $sum: '$pnl' },
                  winCount:    { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
                  lossCount:   { $sum: { $cond: [{ $lt: ['$pnl', 0] }, 1, 0] } },
                  grossProfit: { $sum: { $cond: [{ $gt: ['$pnl', 0] }, '$pnl', 0] } },
                  grossLoss:   { $sum: { $cond: [{ $lt: ['$pnl', 0] }, { $abs: '$pnl' }, 0] } },
                  sumR:        { $sum: { $ifNull: ['$rMultiple', 0] } },
                  rCount:      { $sum: { $cond: [{ $ne: ['$rMultiple', null] }, 1, 0] } },
                  avgWin:      { $avg: { $cond: [{ $gt: ['$pnl', 0] }, '$pnl', '$$REMOVE'] } },
                  avgLoss:     { $avg: { $cond: [{ $lt: ['$pnl', 0] }, '$pnl', '$$REMOVE'] } },
                },
              },
            ],

            // ── P&L by period (auto-granularity) ─────────────────────────
            pnlByPeriod: [
              {
                $group: {
                  _id: { $dateToString: { format: dateFormat, date: '$entryDate', timezone: 'UTC' } },
                  pnl:   { $sum: '$pnl' },
                  wins:  { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
              { $project: { period: '$_id', pnl: 1, wins: 1, count: 1, _id: 0 } },
            ],

            // ── P&L by symbol (top 10 by absolute P&L) ───────────────────
            pnlBySymbol: [
              {
                $group: {
                  _id:   '$symbol',
                  pnl:   { $sum: '$pnl' },
                  wins:  { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
                  count: { $sum: 1 },
                },
              },
              { $addFields: { absPnl: { $abs: '$pnl' } } },
              { $sort: { absPnl: -1 } },
              { $limit: 11 },
              {
                $project: {
                  label:      '$_id',
                  pnl:        1,
                  tradeCount: '$count',
                  winRate:    { $multiply: [{ $cond: ['$count', { $divide: ['$wins', '$count'] }, 0] }, 100] },
                  _id: 0,
                },
              },
            ],

            // ── P&L by tag ────────────────────────────────────────────────
            pnlByTag: [
              { $unwind: { path: '$tags', preserveNullAndEmptyArrays: false } },
              {
                $group: {
                  _id:   '$tags',
                  pnl:   { $sum: '$pnl' },
                  wins:  { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
                  count: { $sum: 1 },
                },
              },
              { $addFields: { absPnl: { $abs: '$pnl' } } },
              { $sort: { absPnl: -1 } },
              { $limit: 11 },
              {
                $project: {
                  label:      '$_id',
                  pnl:        1,
                  tradeCount: '$count',
                  winRate:    { $multiply: [{ $cond: ['$count', { $divide: ['$wins', '$count'] }, 0] }, 100] },
                  _id: 0,
                },
              },
            ],

            // ── P&L by asset class ────────────────────────────────────────
            pnlByAssetClass: [
              {
                $group: {
                  _id:   '$assetClass',
                  pnl:   { $sum: '$pnl' },
                  wins:  { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
                  count: { $sum: 1 },
                },
              },
              { $sort: { pnl: -1 } },
              {
                $project: {
                  label:      { $ifNull: ['$_id', 'Unknown'] },
                  pnl:        1,
                  tradeCount: '$count',
                  winRate:    { $multiply: [{ $cond: ['$count', { $divide: ['$wins', '$count'] }, 0] }, 100] },
                  _id: 0,
                },
              },
            ],

            // ── P&L by day of week ────────────────────────────────────────
            pnlByDayOfWeek: [
              { $addFields: { dow: { $dayOfWeek: '$entryDate' } } },
              {
                $group: {
                  _id:   '$dow',
                  pnl:   { $sum: '$pnl' },
                  wins:  { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
              {
                $project: {
                  day: {
                    $switch: {
                      branches: Object.entries(DOW_MAP).map(([k, v]) => ({ case: { $eq: ['$_id', Number(k)] }, then: v })),
                      default: '?',
                    },
                  },
                  pnl:        1,
                  tradeCount: '$count',
                  winRate:    { $multiply: [{ $cond: ['$count', { $divide: ['$wins', '$count'] }, 0] }, 100] },
                  _id: 0,
                },
              },
            ],

            // ── P&L by hour of day ────────────────────────────────────────
            pnlByHourOfDay: [
              { $addFields: { hour: { $hour: '$entryDate' } } },
              {
                $group: {
                  _id:   '$hour',
                  pnl:   { $sum: '$pnl' },
                  wins:  { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
              {
                $project: {
                  hour:       '$_id',
                  pnl:        1,
                  tradeCount: '$count',
                  winRate:    { $multiply: [{ $cond: ['$count', { $divide: ['$wins', '$count'] }, 0] }, 100] },
                  _id: 0,
                },
              },
            ],

            // ── R-multiple distribution ───────────────────────────────────
            rDistribution: [
              { $match: { rMultiple: { $ne: null } } },
              { $addFields: { rBucket: rBucketExpr } },
              { $group: { _id: '$rBucket', count: { $sum: 1 }, pnl: { $sum: '$pnl' } } },
              { $project: { bucket: '$_id', count: 1, pnl: 1, _id: 0 } },
            ],

            // ── Duration vs P&L (scatter) ─────────────────────────────────
            durationVsPnl: [
              { $match: { exitDate: { $ne: null } } },
              {
                $project: {
                  durationMinutes: { $divide: [{ $subtract: ['$exitDate', '$entryDate'] }, 60_000] },
                  pnl: 1,
                  symbol: 1,
                  _id: 0,
                },
              },
              { $match: { durationMinutes: { $gt: 0 } } },
              { $limit: 500 },
            ],
          },
        },
      ]),

      // Time-series: sorted trades for sequential computations
      Trade.find(filter)
        .sort({ entryDate: 1 })
        .select('entryDate exitDate pnl rMultiple')
        .lean(),
    ]);

    // ── Unpack facet results ──────────────────────────────────────────────────

    const {
      coreStats, pnlByPeriod, pnlBySymbol, pnlByTag,
      pnlByAssetClass, pnlByDayOfWeek, pnlByHourOfDay,
      rDistribution, durationVsPnl,
    } = facetResult[0];

    const s = coreStats[0] || {
      totalTrades: 0, netPnl: 0, winCount: 0, lossCount: 0,
      grossProfit: 0, grossLoss: 0, sumR: 0, rCount: 0, avgWin: 0, avgLoss: 0,
    };

    const winRate       = s.totalTrades > 0 ? (s.winCount / s.totalTrades) * 100 : 0;
    const profitFactor  = s.grossLoss > 0 ? s.grossProfit / s.grossLoss : s.grossProfit > 0 ? 9999 : 0;
    const expectancy    = s.rCount > 0 ? s.sumR / s.rCount : null;

    // ── Sequential computations over sorted time-series ───────────────────────

    let cWin = 0, cLoss = 0;
    let longestWinStreak = 0, longestLossStreak = 0;
    let cumPnl = 0, peak = 0, maxDrawdown = 0;
    const equityCurve  = [];
    const drawdownCurve = [];

    for (const t of timeSeries) {
      const win = (t.pnl || 0) > 0;
      if (win) { cWin++; cLoss = 0; longestWinStreak  = Math.max(longestWinStreak,  cWin); }
      else     { cLoss++; cWin = 0; longestLossStreak = Math.max(longestLossStreak, cLoss); }

      cumPnl += t.pnl || 0;
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl;
      if (dd > maxDrawdown) maxDrawdown = dd;

      const date = t.entryDate.toISOString().split('T')[0];
      equityCurve.push({ date, cumulativePnl: +cumPnl.toFixed(2) });
      drawdownCurve.push({ date, drawdown: +(-dd).toFixed(2) });
    }

    const currentStreak = cWin > 0 ? cWin : -cLoss;

    // ── Sort R distribution into fixed order ──────────────────────────────────

    const rMultipleDistribution = R_ORDER.map(bucket => {
      const found = rDistribution.find(r => r.bucket === bucket);
      return { bucket, count: found?.count || 0, pnl: found?.pnl || 0 };
    });

    return sendSuccess(res, 200, {
      granularity,
      // Core
      netPnl:        +((s.netPnl || 0).toFixed(2)),
      totalTrades:   s.totalTrades,
      winCount:      s.winCount,
      lossCount:     s.lossCount,
      winRate:       +winRate.toFixed(2),
      averageWin:    +((s.avgWin  || 0).toFixed(2)),
      averageLoss:   +((s.avgLoss || 0).toFixed(2)),
      profitFactor:  +profitFactor.toFixed(3),
      expectancy:    expectancy !== null ? +expectancy.toFixed(3) : null,
      currentStreak,
      longestWinStreak,
      longestLossStreak,
      maxDrawdown:   +maxDrawdown.toFixed(2),
      // Time series
      equityCurve,
      drawdownCurve,
      // Period breakdown
      pnlByPeriod,
      // Breakdowns
      pnlBySymbol,
      pnlByTag,
      pnlByAssetClass,
      pnlByDayOfWeek,
      pnlByHourOfDay,
      // Distributions
      rMultipleDistribution,
      durationVsPnl,
    });
  } catch (err) { next(err); }
};

// ─── Mistakes summary ─────────────────────────────────────────────────────────
// GET /api/analytics/mistakes

exports.mistakesSummary = async (req, res, next) => {
  try {
    const filter = buildFilter(req.user.id, req.query);
    // Remove status filter so open trades with mistakes are also counted
    delete filter.status;

    const result = await Trade.aggregate([
      { $match: { ...filter, mistakes: { $exists: true, $ne: [] } } },
      { $unwind: '$mistakes' },
      {
        $group: {
          _id:   '$mistakes',
          count: { $sum: 1 },
          pnl:   { $sum: '$pnl' },
          wins:  { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
        },
      },
      { $sort: { count: -1 } },
      {
        $project: {
          mistake:    '$_id',
          count:      1,
          pnl:        1,
          winRate:    { $multiply: [{ $cond: ['$count', { $divide: ['$wins', '$count'] }, 0] }, 100] },
          _id:        0,
        },
      },
    ]);

    return sendSuccess(res, 200, result);
  } catch (err) { next(err); }
};

