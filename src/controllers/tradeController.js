/**
 * controllers/tradeController.js
 * Full CRUD + bulk + CSV import/export for trades.
 * All queries are scoped to req.user.id.
 */

const mongoose = require('mongoose');
const Trade   = require('../models/Trade');
const Account = require('../models/Account');
const { sendSuccess, sendError } = require('../utils/response');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a MongoDB filter from query params, always scoped to userId. */
function buildFilter(userId, q) {
  const f = { userId };

  if (q.accountId  && mongoose.isValidObjectId(q.accountId))  f.accountId  = q.accountId;
  if (q.strategyId && mongoose.isValidObjectId(q.strategyId)) f.strategyId = q.strategyId;
  if (q.symbol)    f.symbol    = q.symbol.toUpperCase();
  if (q.status)    f.status    = q.status;
  if (q.direction) f.direction = q.direction;
  if (q.tags)      f.tags      = { $in: Array.isArray(q.tags) ? q.tags : q.tags.split(',') };

  if (q.dateFrom || q.dateTo) {
    f.entryDate = {};
    if (q.dateFrom) f.entryDate.$gte = new Date(q.dateFrom);
    if (q.dateTo)   f.entryDate.$lte = new Date(q.dateTo);
  }

  return f;
}

const CSV_HEADERS = [
  'date','symbol','assetClass','direction','entryDate','exitDate',
  'entryPrice','exitPrice','quantity','stopLoss','takeProfit','fees',
  'status','pnl','rMultiple','tags','emotion','executionGrade','notes',
];

function tradesToCsv(trades) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [CSV_HEADERS.join(',')];
  for (const t of trades) {
    rows.push([
      escape(t.entryDate?.toISOString().split('T')[0]),
      escape(t.symbol),
      escape(t.assetClass),
      escape(t.direction),
      escape(t.entryDate?.toISOString()),
      escape(t.exitDate?.toISOString()),
      escape(t.entryPrice),
      escape(t.exitPrice),
      escape(t.quantity),
      escape(t.stopLoss),
      escape(t.takeProfit),
      escape(t.fees),
      escape(t.status),
      escape(t.pnl),
      escape(t.rMultiple),
      escape((t.tags || []).join(';')),
      escape(t.emotion),
      escape(t.executionGrade),
      escape(t.notes),
    ].join(','));
  }
  return rows.join('\n');
}

function parseCsvRow(headers, values) {
  const row = {};
  headers.forEach((h, i) => { row[h] = (values[i] || '').replace(/^"|"$/g, '').trim(); });
  return row;
}

// ─── List ─────────────────────────────────────────────────────────────────────

exports.list = async (req, res, next) => {
  try {
    const {
      sortBy = 'entryDate', sortDir = 'desc',
      page = 1, limit = 25,
      ...rest
    } = req.query;

    const filter  = buildFilter(req.user.id, rest);
    const skip    = (Number(page) - 1) * Number(limit);
    const sortObj = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

    const [trades, total] = await Promise.all([
      Trade.find(filter)
        .sort(sortObj)
        .skip(skip)
        .limit(Number(limit))
        .populate('accountId', 'name currency')
        .populate('strategyId', 'name'),
      Trade.countDocuments(filter),
    ]);

    return sendSuccess(res, 200, {
      trades,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

// ─── Create ───────────────────────────────────────────────────────────────────

exports.create = async (req, res, next) => {
  try {
    // Verify account belongs to user
    const account = await Account.findOne({ _id: req.body.accountId, userId: req.user.id });
    if (!account) return sendError(res, 400, 'Invalid account.', 'INVALID_ACCOUNT');

    const trade = await Trade.create({ ...req.body, userId: req.user.id });
    return sendSuccess(res, 201, trade, 'Trade logged.');
  } catch (err) { next(err); }
};

// ─── Detail ───────────────────────────────────────────────────────────────────

exports.detail = async (req, res, next) => {
  try {
    const trade = await Trade.findOne({ _id: req.params.id, userId: req.user.id })
      .populate('accountId', 'name currency')
      .populate('strategyId', 'name');
    if (!trade) return sendError(res, 404, 'Trade not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, trade);
  } catch (err) { next(err); }
};

// ─── Update ───────────────────────────────────────────────────────────────────

exports.update = async (req, res, next) => {
  try {
    // Merge the incoming update onto the existing document so the pre-save hook
    // can see all fields and recompute pnl/rMultiple correctly.
    const existing = await Trade.findOne({ _id: req.params.id, userId: req.user.id });
    if (!existing) return sendError(res, 404, 'Trade not found.', 'NOT_FOUND');

    Object.assign(existing, req.body);
    await existing.save();

    return sendSuccess(res, 200, existing, 'Trade updated.');
  } catch (err) { next(err); }
};

// ─── Delete ───────────────────────────────────────────────────────────────────

exports.remove = async (req, res, next) => {
  try {
    const trade = await Trade.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!trade) return sendError(res, 404, 'Trade not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, null, 'Trade deleted.');
  } catch (err) { next(err); }
};

// ─── Bulk delete ──────────────────────────────────────────────────────────────

exports.bulkDelete = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return sendError(res, 400, 'ids array required.', 'VALIDATION_ERROR');

    const result = await Trade.deleteMany({ _id: { $in: ids }, userId: req.user.id });
    return sendSuccess(res, 200, { deleted: result.deletedCount }, `${result.deletedCount} trade(s) deleted.`);
  } catch (err) { next(err); }
};

// ─── Bulk tag ─────────────────────────────────────────────────────────────────

exports.bulkTag = async (req, res, next) => {
  try {
    const { ids, tags, mode = 'add' } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !Array.isArray(tags))
      return sendError(res, 400, 'ids and tags arrays required.', 'VALIDATION_ERROR');

    const update = mode === 'remove'
      ? { $pullAll: { tags } }
      : { $addToSet: { tags: { $each: tags } } };

    await Trade.updateMany({ _id: { $in: ids }, userId: req.user.id }, update);
    return sendSuccess(res, 200, null, 'Tags updated.');
  } catch (err) { next(err); }
};

// ─── Export CSV ───────────────────────────────────────────────────────────────

exports.exportCsv = async (req, res, next) => {
  try {
    const filter = buildFilter(req.user.id, req.query);
    const trades = await Trade.find(filter).sort({ entryDate: -1 }).limit(10000);
    const csv    = tradesToCsv(trades);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tradiary-export.csv"');
    return res.send(csv);
  } catch (err) { next(err); }
};

// ─── Import CSV ───────────────────────────────────────────────────────────────

exports.importCsv = async (req, res, next) => {
  try {
    const { rows, accountId, columnMap } = req.body;
    // rows: array of raw objects from the CSV (post column-mapping on client)
    // columnMap: { csvHeader: tradeField }

    if (!Array.isArray(rows) || rows.length === 0)
      return sendError(res, 400, 'No rows provided.', 'VALIDATION_ERROR');

    const account = await Account.findOne({ _id: accountId, userId: req.user.id });
    if (!account) return sendError(res, 400, 'Invalid account.', 'INVALID_ACCOUNT');

    const created = [];
    const failed  = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      try {
        // Apply column mapping
        const mapped = {};
        for (const [csvCol, tradeField] of Object.entries(columnMap || {})) {
          if (tradeField && raw[csvCol] !== undefined) mapped[tradeField] = raw[csvCol];
        }

        // Coerce types
        if (mapped.entryPrice)  mapped.entryPrice  = Number(mapped.entryPrice);
        if (mapped.exitPrice)   mapped.exitPrice   = Number(mapped.exitPrice) || null;
        if (mapped.quantity)    mapped.quantity    = Number(mapped.quantity);
        if (mapped.stopLoss)    mapped.stopLoss    = Number(mapped.stopLoss)  || null;
        if (mapped.takeProfit)  mapped.takeProfit  = Number(mapped.takeProfit)|| null;
        if (mapped.fees)        mapped.fees        = Number(mapped.fees)      || 0;
        if (mapped.entryDate)   mapped.entryDate   = new Date(mapped.entryDate);
        if (mapped.exitDate)    mapped.exitDate    = new Date(mapped.exitDate) || null;
        if (mapped.tags)        mapped.tags        = String(mapped.tags).split(';').filter(Boolean);
        if (mapped.symbol)      mapped.symbol      = String(mapped.symbol).toUpperCase();

        const trade = await Trade.create({ ...mapped, userId: req.user.id, accountId });
        created.push(trade._id);
      } catch (err) {
        failed.push({ row: i + 1, reason: err.message });
      }
    }

    return sendSuccess(res, 201, { created: created.length, failed }, `${created.length} trade(s) imported.`);
  } catch (err) { next(err); }
};

// ─── Calendar data ────────────────────────────────────────────────────────────

exports.calendarData = async (req, res, next) => {
  try {
    const { year, month, accountId } = req.query;
    if (!year || !month) return sendError(res, 400, 'year and month required.', 'VALIDATION_ERROR');

    const from = new Date(Number(year), Number(month) - 1, 1);
    const to   = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    const filter = {
      userId: req.user.id,
      entryDate: { $gte: from, $lte: to },
      status: 'closed',
    };
    if (accountId) filter.accountId = accountId;

    const trades = await Trade.find(filter).select('entryDate pnl symbol direction');

    // Aggregate by date string YYYY-MM-DD
    const days = {};
    for (const t of trades) {
      const d = t.entryDate.toISOString().split('T')[0];
      if (!days[d]) days[d] = { pnl: 0, count: 0, trades: [] };
      days[d].pnl   += t.pnl || 0;
      days[d].count += 1;
      days[d].trades.push({ id: t._id, symbol: t.symbol, pnl: t.pnl, direction: t.direction });
    }

    return sendSuccess(res, 200, days);
  } catch (err) { next(err); }
};

// ─── Seed sample trades (onboarding) ─────────────────────────────────────────

const SAMPLE_TRADES = [
  { symbol:'AAPL',  assetClass:'stock',   direction:'long',  entryDate:-12, exitDays:3,  entryPrice:175.20, exitPrice:182.50, quantity:20, stopLoss:170.00, fees:0 },
  { symbol:'TSLA',  assetClass:'stock',   direction:'short', entryDate:-10, exitDays:2,  entryPrice:245.00, exitPrice:258.40, quantity:10, stopLoss:252.00, fees:0 },
  { symbol:'EURUSD',assetClass:'forex',   direction:'long',  entryDate:-9,  exitDays:1,  entryPrice:1.0850, exitPrice:1.0920, quantity:10000, stopLoss:1.0800, fees:2 },
  { symbol:'SPY',   assetClass:'stock',   direction:'long',  entryDate:-8,  exitDays:4,  entryPrice:448.30, exitPrice:456.00, quantity:15, stopLoss:443.00, fees:0 },
  { symbol:'BTCUSD',assetClass:'crypto',  direction:'long',  entryDate:-7,  exitDays:2,  entryPrice:42000,  exitPrice:44200,  quantity:0.5, stopLoss:40500, fees:10 },
  { symbol:'NVDA',  assetClass:'stock',   direction:'long',  entryDate:-6,  exitDays:3,  entryPrice:460.00, exitPrice:448.00, quantity:8, stopLoss:452.00, fees:0 },
  { symbol:'QQQ',   assetClass:'stock',   direction:'short', entryDate:-5,  exitDays:1,  entryPrice:380.00, exitPrice:373.50, quantity:20, stopLoss:384.00, fees:0 },
  { symbol:'AMZN',  assetClass:'stock',   direction:'long',  entryDate:-4,  exitDays:2,  entryPrice:178.50, exitPrice:185.20, quantity:12, stopLoss:174.00, fees:0 },
  { symbol:'GBPUSD',assetClass:'forex',   direction:'short', entryDate:-3,  exitDays:1,  entryPrice:1.2720, exitPrice:1.2660, quantity:10000, stopLoss:1.2760, fees:2 },
  { symbol:'MSFT',  assetClass:'stock',   direction:'long',  entryDate:-2,  exitDays:1,  entryPrice:378.00, exitPrice:390.00, quantity:10, stopLoss:372.00, fees:0 },
];

exports.seedSamples = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Don't double-seed
    const existing = await Trade.countDocuments({ userId, isSample: true });
    if (existing > 0) {
      return sendSuccess(res, 200, null, 'Sample trades already present.');
    }

    // Need at least one account — find or skip
    const account = await Account.findOne({ userId });
    if (!account) {
      return sendError(res, 400, 'Please create a trading account first.', 'NO_ACCOUNT');
    }

    const now = new Date();
    const trades = SAMPLE_TRADES.map(s => {
      const entryDate = new Date(now);
      entryDate.setDate(entryDate.getDate() + s.entryDate);
      entryDate.setHours(9, 30, 0, 0);
      const exitDate = new Date(entryDate);
      exitDate.setDate(exitDate.getDate() + s.exitDays);
      exitDate.setHours(15, 30, 0, 0);

      return {
        userId,
        accountId: account._id,
        symbol:      s.symbol,
        assetClass:  s.assetClass,
        direction:   s.direction,
        entryDate,
        exitDate,
        entryPrice:  s.entryPrice,
        exitPrice:   s.exitPrice,
        quantity:    s.quantity,
        stopLoss:    s.stopLoss,
        fees:        s.fees,
        status:      'closed',
        tags:        ['sample'],
        notes:       'Sample trade — created by Tradiary onboarding. Safe to delete.',
        isSample:    true,
      };
    });

    await Trade.insertMany(trades);
    return sendSuccess(res, 201, null, '10 sample trades seeded.');
  } catch (err) { next(err); }
};

// ─── Clear sample trades ──────────────────────────────────────────────────────

exports.clearSamples = async (req, res, next) => {
  try {
    const result = await Trade.deleteMany({ userId: req.user.id, isSample: true });
    return sendSuccess(res, 200, { deleted: result.deletedCount }, 'Sample trades cleared.');
  } catch (err) { next(err); }
};

