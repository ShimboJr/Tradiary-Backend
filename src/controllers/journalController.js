/**
 * controllers/journalController.js
 * One JournalEntry per user per calendar day (upsert pattern).
 * Also exposes a mood-vs-pnl time series endpoint.
 */
const mongoose    = require('mongoose');
const JournalEntry = require('../models/JournalEntry');
const Trade        = require('../models/Trade');
const { sendSuccess, sendError } = require('../utils/response');

// GET /api/journal — list entries, optionally filtered by date range
exports.list = async (req, res, next) => {
  try {
    const { dateFrom, dateTo, limit = 90 } = req.query;
    const filter = { userId: req.user.id };
    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = dateFrom;
      if (dateTo)   filter.date.$lte = dateTo;
    }
    const entries = await JournalEntry.find(filter)
      .sort({ date: -1 })
      .limit(Number(limit));
    return sendSuccess(res, 200, entries);
  } catch (err) { next(err); }
};

// GET /api/journal/:date — single entry for a date (YYYY-MM-DD)
exports.getByDate = async (req, res, next) => {
  try {
    const entry = await JournalEntry.findOne({ userId: req.user.id, date: req.params.date });
    return sendSuccess(res, 200, entry || null);
  } catch (err) { next(err); }
};

// PUT /api/journal/:date — create or update entry for that date (upsert)
exports.upsert = async (req, res, next) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return sendError(res, 400, 'Date must be YYYY-MM-DD.', 'VALIDATION_ERROR');

    const { mood, marketNotes, lessonsLearned } = req.body;
    const entry = await JournalEntry.findOneAndUpdate(
      { userId: req.user.id, date },
      { $set: { mood, marketNotes, lessonsLearned } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return sendSuccess(res, 200, entry, 'Journal entry saved.');
  } catch (err) { next(err); }
};

// DELETE /api/journal/:date
exports.remove = async (req, res, next) => {
  try {
    await JournalEntry.findOneAndDelete({ userId: req.user.id, date: req.params.date });
    return sendSuccess(res, 200, null, 'Entry deleted.');
  } catch (err) { next(err); }
};

// GET /api/journal/mood-chart — mood vs daily P&L time series
exports.moodChart = async (req, res, next) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const userId = new mongoose.Types.ObjectId(req.user.id);

    // Journals with mood set
    const jFilter = { userId: req.user.id, mood: { $ne: null } };
    if (dateFrom) jFilter.date = { ...jFilter.date, $gte: dateFrom };
    if (dateTo)   jFilter.date = { ...jFilter.date, $lte: dateTo };

    // Daily P&L from closed trades
    const tradeFilter = { userId, status: 'closed' };
    if (dateFrom) tradeFilter.entryDate = { $gte: new Date(dateFrom) };
    if (dateTo)   tradeFilter.entryDate = { ...(tradeFilter.entryDate || {}), $lte: new Date(dateTo) };

    const [journals, dailyPnl] = await Promise.all([
      JournalEntry.find(jFilter).sort({ date: 1 }).select('date mood'),
      Trade.aggregate([
        { $match: tradeFilter },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$entryDate' } }, pnl: { $sum: '$pnl' } } },
        { $project: { date: '$_id', pnl: 1, _id: 0 } },
      ]),
    ]);

    const pnlMap = Object.fromEntries(dailyPnl.map(d => [d.date, d.pnl]));
    const chart = journals.map(j => ({
      date: j.date,
      mood: j.mood,
      pnl:  pnlMap[j.date] ?? null,
    }));

    return sendSuccess(res, 200, chart);
  } catch (err) { next(err); }
};
