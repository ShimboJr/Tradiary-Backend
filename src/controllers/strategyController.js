/**
 * controllers/strategyController.js
 * CRUD for Strategy (Playbook). Discipline score computed on trade save
 * in tradeController — strategy controller just manages the model itself.
 */
const Strategy = require('../models/Strategy');
const Trade    = require('../models/Trade');
const { sendSuccess, sendError } = require('../utils/response');

exports.list = async (req, res, next) => {
  try {
    const strategies = await Strategy.find({ userId: req.user.id }).sort({ createdAt: -1 });
    return sendSuccess(res, 200, strategies);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { name, description, rules, exampleScreenshots, color } = req.body;
    const strategy = await Strategy.create({
      userId: req.user.id,
      name, description,
      rules: (rules || []).map((r, i) => ({ text: r.text || r, order: r.order ?? i })),
      exampleScreenshots: exampleScreenshots || [],
      color: color || '#3b8ef3',
    });
    return sendSuccess(res, 201, strategy, 'Strategy created.');
  } catch (err) { next(err); }
};

exports.detail = async (req, res, next) => {
  try {
    const strategy = await Strategy.findOne({ _id: req.params.id, userId: req.user.id });
    if (!strategy) return sendError(res, 404, 'Strategy not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, strategy);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const strategy = await Strategy.findOne({ _id: req.params.id, userId: req.user.id });
    if (!strategy) return sendError(res, 404, 'Strategy not found.', 'NOT_FOUND');

    const { name, description, rules, exampleScreenshots, color } = req.body;
    if (name !== undefined) strategy.name = name;
    if (description !== undefined) strategy.description = description;
    if (color !== undefined) strategy.color = color;
    if (exampleScreenshots !== undefined) strategy.exampleScreenshots = exampleScreenshots;
    if (rules !== undefined) {
      strategy.rules = rules.map((r, i) => ({
        _id: r._id || undefined,
        text: r.text || r,
        order: r.order ?? i,
      }));
    }

    await strategy.save();
    return sendSuccess(res, 200, strategy, 'Strategy updated.');
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const strategy = await Strategy.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!strategy) return sendError(res, 404, 'Strategy not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, null, 'Strategy deleted.');
  } catch (err) { next(err); }
};

// GET /api/strategies/:id/trades — recent trades for strategy detail page
exports.trades = async (req, res, next) => {
  try {
    const trades = await Trade.find({ strategyId: req.params.id, userId: req.user.id })
      .sort({ entryDate: -1 }).limit(50).select('symbol direction entryDate pnl status disciplineScore executionGrade');
    return sendSuccess(res, 200, trades);
  } catch (err) { next(err); }
};
