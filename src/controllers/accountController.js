/**
 * controllers/accountController.js
 * CRUD for trading accounts. All queries scoped to req.user.id.
 */

const Account = require('../models/Account');
const { sendSuccess, sendError } = require('../utils/response');

// GET /api/accounts
exports.list = async (req, res, next) => {
  try {
    const accounts = await Account.find({ userId: req.user.id }).sort({ createdAt: 1 });
    return sendSuccess(res, 200, accounts);
  } catch (err) { next(err); }
};

// POST /api/accounts
exports.create = async (req, res, next) => {
  try {
    const { name, type, broker, startingBalance, currency } = req.body;
    const account = await Account.create({
      userId: req.user.id,
      name, type, broker, startingBalance, currency,
    });
    return sendSuccess(res, 201, account, 'Account created.');
  } catch (err) { next(err); }
};

// PATCH /api/accounts/:id
exports.update = async (req, res, next) => {
  try {
    const account = await Account.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!account) return sendError(res, 404, 'Account not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, account, 'Account updated.');
  } catch (err) { next(err); }
};

// DELETE /api/accounts/:id
exports.remove = async (req, res, next) => {
  try {
    const account = await Account.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!account) return sendError(res, 404, 'Account not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, null, 'Account deleted.');
  } catch (err) { next(err); }
};
