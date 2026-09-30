/**
 * controllers/accountController.js
 * CRUD for trading accounts. All queries scoped to req.user.id.
 */

const Account = require('../models/Account');
const { sendSuccess, sendError } = require('../utils/response');

// ── List ──────────────────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const accounts = await Account.find({ userId: req.user.id }).sort({ createdAt: 1 });
    return sendSuccess(res, 200, accounts);
  } catch (err) { next(err); }
};

// ── Create ────────────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const {
      name, accountNumber, type, broker, currency,
      // Accept both names — SettingsPage used to send 'initialBalance'
      startingBalance, initialBalance,
    } = req.body;

    const account = await Account.create({
      userId:          req.user.id,
      name,
      accountNumber:   accountNumber   ?? '',
      type:            type            ?? 'live',
      broker:          broker          ?? '',
      currency:        currency        ?? 'USD',
      startingBalance: startingBalance ?? initialBalance ?? 0,
    });
    return sendSuccess(res, 201, account, 'Account created.');
  } catch (err) { next(err); }
};

// ── Update (explicit whitelist — prevents arbitrary field injection) ───────────
exports.update = async (req, res, next) => {
  try {
    const ALLOWED = ['name', 'accountNumber', 'type', 'broker', 'currency', 'isDefault', 'isArchived'];
    const updates = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    // Accept both field names for starting balance
    const bal = req.body.startingBalance ?? req.body.initialBalance;
    if (bal !== undefined) updates.startingBalance = Number(bal);

    const account = await Account.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!account) return sendError(res, 404, 'Account not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, account, 'Account updated.');
  } catch (err) { next(err); }
};

// ── Delete ────────────────────────────────────────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const account = await Account.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!account) return sendError(res, 404, 'Account not found.', 'NOT_FOUND');
    return sendSuccess(res, 200, null, 'Account deleted.');
  } catch (err) { next(err); }
};
