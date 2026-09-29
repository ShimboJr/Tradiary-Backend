/**
 * controllers/watchlistController.js
 * Simple CRUD for manual watchlist items (no real-time data).
 */
const WatchlistItem = require('../models/WatchlistItem');
const { sendSuccess, sendError } = require('../utils/response');

exports.list = async (req, res, next) => {
  try {
    const items = await WatchlistItem.find({ userId: req.user.id }).sort({ priority: 1, createdAt: -1 });
    return sendSuccess(res, 200, items);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const item = await WatchlistItem.create({ ...req.body, userId: req.user.id });
    return sendSuccess(res, 201, item, 'Added to watchlist.');
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const item = await WatchlistItem.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!item) return sendError(res, 404, 'Item not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, item, 'Updated.');
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const item = await WatchlistItem.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!item) return sendError(res, 404, 'Item not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, null, 'Removed from watchlist.');
  } catch (err) { next(err); }
};
