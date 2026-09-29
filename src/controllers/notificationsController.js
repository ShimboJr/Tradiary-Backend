/**
 * controllers/notificationsController.js
 */

const Notification = require('../models/Notification');
const { sendSuccess, sendError } = require('../utils/response');

/** GET /api/notifications — latest 30, unread first */
exports.list = async (req, res, next) => {
  try {
    const items = await Notification.find({ userId: req.user.id })
      .sort({ read: 1, createdAt: -1 })
      .limit(30)
      .lean();
    return sendSuccess(res, 200, items);
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/notifications/:id/read */
exports.markRead = async (req, res, next) => {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { read: true },
      { new: true }
    );
    if (!n) return sendError(res, 404, 'Notification not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, n);
  } catch (err) {
    next(err);
  }
};

/** POST /api/notifications/mark-all-read */
exports.markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id, read: false },
      { read: true }
    );
    return sendSuccess(res, 200, null, 'All notifications marked as read.');
  } catch (err) {
    next(err);
  }
};
