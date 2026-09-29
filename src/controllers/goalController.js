/**
 * controllers/goalController.js
 * CRUD + live progress calculation for performance goals.
 */
const mongoose = require('mongoose');
const Goal     = require('../models/Goal');
const Trade    = require('../models/Trade');
const { sendSuccess, sendError } = require('../utils/response');

// ─── Native date helpers (no external dependency) ─────────────────────────────
function _startOfWeek(d) {          // Monday start
  const date = new Date(d);
  const day  = date.getDay();        // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function _endOfWeek(d) {            // Sunday end
  const end = new Date(_startOfWeek(d));
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}
function _startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function _endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

// ─── Compute current period date range for a goal ─────────────────────────────
function periodRange(goal) {
  const now = new Date();
  if (goal.period === 'weekly') {
    return { $gte: _startOfWeek(now), $lte: _endOfWeek(now) };
  }
  return { $gte: _startOfMonth(now), $lte: _endOfMonth(now) };
}

// ─── Compute the live value for a single goal ─────────────────────────────────
async function computeProgress(goal, userId) {
  const filter = {
    userId: new mongoose.Types.ObjectId(userId),
    status: 'closed',
    entryDate: periodRange(goal),
  };
  if (goal.accountId) filter.accountId = goal.accountId;

  const agg = await Trade.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        netPnl:    { $sum: '$pnl' },
        count:     { $sum: 1 },
        winCount:  { $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] } },
      },
    },
  ]);

  const stats = agg[0] || { netPnl: 0, count: 0, winCount: 0 };

  let currentValue;
  switch (goal.type) {
    case 'profit_target': currentValue = stats.netPnl; break;
    case 'trade_count':   currentValue = stats.count;  break;
    case 'win_rate':      currentValue = stats.count > 0 ? (stats.winCount / stats.count) * 100 : 0; break;
    case 'max_drawdown':  {
      // Compute current drawdown for this period
      const trades = await Trade.find(filter).sort({ entryDate: 1 }).select('pnl');
      let cum = 0, peak = 0, maxDD = 0;
      for (const t of trades) {
        cum += t.pnl || 0;
        if (cum > peak) peak = cum;
        maxDD = Math.max(maxDD, peak - cum);
      }
      currentValue = maxDD;
      break;
    }
    default: currentValue = 0;
  }

  const progress = goal.targetValue !== 0
    ? Math.min(Math.abs(currentValue / goal.targetValue) * 100, 999)
    : 0;

  const breached = goal.type === 'max_drawdown'
    ? currentValue >= goal.targetValue  // drawdown limit exceeded
    : false;

  return { currentValue: +currentValue.toFixed(2), progress: +progress.toFixed(1), breached };
}

// GET /api/goals — list with live progress
exports.list = async (req, res, next) => {
  try {
    const goals = await Goal.find({ userId: req.user.id, isActive: true }).sort({ createdAt: -1 });
    const withProgress = await Promise.all(
      goals.map(async g => ({
        ...g.toObject(),
        ...(await computeProgress(g, req.user.id)),
      }))
    );
    return sendSuccess(res, 200, withProgress);
  } catch (err) { next(err); }
};

// POST /api/goals
exports.create = async (req, res, next) => {
  try {
    const { name, type, period, targetValue, accountId } = req.body;
    const goal = await Goal.create({ userId: req.user.id, name, type, period, targetValue, accountId });
    const progress = await computeProgress(goal, req.user.id);
    return sendSuccess(res, 201, { ...goal.toObject(), ...progress }, 'Goal created.');
  } catch (err) { next(err); }
};

// PATCH /api/goals/:id
exports.update = async (req, res, next) => {
  try {
    const goal = await Goal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!goal) return sendError(res, 404, 'Goal not found.', 'NOT_FOUND');
    const progress = await computeProgress(goal, req.user.id);
    return sendSuccess(res, 200, { ...goal.toObject(), ...progress }, 'Goal updated.');
  } catch (err) { next(err); }
};

// DELETE /api/goals/:id
exports.remove = async (req, res, next) => {
  try {
    const goal = await Goal.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!goal) return sendError(res, 404, 'Goal not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, null, 'Goal deleted.');
  } catch (err) { next(err); }
};
