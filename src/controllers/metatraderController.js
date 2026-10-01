/**
 * controllers/metatraderController.js
 * Handles the MetaTrader EA webhook. Auth uses the X-Tradiary-Token header
 * (hashed SHA-256, compared against IntegrationToken collection) — NOT JWT.
 * Rate-limited separately from the main API.
 *
 * P&L is always computed from first principles using the same formula as
 * manual trades; the broker-reported "profit" field is only used for cross-
 * checking. A warning is logged if they differ by more than $0.01 (swap /
 * commission timing mismatch that the user may want to know about later).
 */

'use strict';

const crypto           = require('crypto');
const { body }         = require('express-validator');
const IntegrationToken = require('../models/IntegrationToken');
const Trade            = require('../models/Trade');
const Account          = require('../models/Account');
const { sendSuccess, sendError } = require('../utils/response');

// ─── Token helpers ────────────────────────────────────────────────────────────

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Resolves the authenticated user from X-Tradiary-Token; returns null on failure. */
async function resolveTokenUser(req, res) {
  const raw = req.headers['x-tradiary-token'];
  if (!raw) {
    sendError(res, 401, 'Missing token.', 'UNAUTHORIZED');
    return null;
  }

  const hash  = hashToken(raw);
  const token = await IntegrationToken.findOne({ tokenHash: hash, revokedAt: null });
  if (!token) {
    sendError(res, 401, 'Invalid or revoked token.', 'UNAUTHORIZED');
    return null;
  }

  // Touch lastUsedAt (fire-and-forget — don't await to avoid latency)
  IntegrationToken.findByIdAndUpdate(token._id, { lastUsedAt: new Date() }).exec().catch(() => {});

  return { userId: token.userId, token };
}

// ─── P&L computation (mirrors Trade.js pre-save hook) ────────────────────────

function computePnl({ direction, entryPrice, exitPrice, quantity, fees = 0 }) {
  if (exitPrice == null || entryPrice == null || quantity == null) return null;
  const raw =
    direction === 'short'
      ? (entryPrice - exitPrice) * quantity
      : (exitPrice - entryPrice) * quantity;
  return parseFloat((raw - fees).toFixed(6));
}

function computeRMultiple({ pnl, entryPrice, stopLoss, quantity }) {
  if (pnl == null || stopLoss == null || entryPrice == null || quantity == null) return null;
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit <= 0) return null;
  return parseFloat((pnl / (riskPerUnit * quantity)).toFixed(3));
}

// ─── Payload validators (reuse express-validator) ────────────────────────────

exports.webhookValidators = [
  body('event').isIn(['trade_open', 'trade_close']).withMessage('event must be trade_open or trade_close'),
  body('ticket').notEmpty().isString().withMessage('ticket required'),
  body('symbol').notEmpty().isString().withMessage('symbol required'),
  body('type').isIn(['buy', 'sell']).withMessage('type must be buy or sell'),
  body('lots').isFloat({ gt: 0 }).withMessage('lots must be positive'),
  body('price').isFloat({ gt: 0 }).withMessage('price must be positive'),
  body('time').isISO8601().withMessage('time must be ISO 8601'),
  body('sl').optional({ nullable: true }).isFloat(),
  body('tp').optional({ nullable: true }).isFloat(),
  body('commission').optional({ nullable: true }).isFloat(),
  body('swap').optional({ nullable: true }).isFloat(),
  body('profit').optional({ nullable: true }).isFloat(),
  // Close-only fields
  body('close_price').if(body('event').equals('trade_close')).isFloat({ gt: 0 }).withMessage('close_price required for trade_close'),
  body('close_time').if(body('event').equals('trade_close')).isISO8601().withMessage('close_time must be ISO 8601 for trade_close'),
];

// ─── Webhook handler ──────────────────────────────────────────────────────────

exports.webhook = async (req, res) => {
  // 1. Token auth — validates X-Tradiary-Token header against hashed DB record
  const auth = await resolveTokenUser(req, res);
  if (!auth) return; // response already sent

  // 2. Payload already validated by webhookValidators + validate middleware (see integrations router)

  const {
    event,
    ticket,
    symbol,
    type,
    lots,
    price,
    sl,
    tp,
    time,
    commission = 0,
    swap = 0,
    profit: brokerProfit,
    close_price,
    close_time,
  } = req.body;

  const direction = type === 'buy' ? 'long' : 'short';
  const fees      = Math.abs(Number(commission || 0)) + Math.abs(Number(swap || 0));

  // 3. Find the user's default / first account (EA doesn't send accountId)
  let account = await Account.findOne({ userId: auth.userId, isArchived: { $ne: true } });
  if (!account) {
    // Terse response — EA just logs it
    return res.status(400).json({ success: false, error: { message: 'No trading account found.' } });
  }

  // ─── trade_open ───────────────────────────────────────────────────────────
  if (event === 'trade_open') {
    // Upsert by (userId, externalId) — idempotent on duplicate delivery
    const filter = { userId: auth.userId, externalId: String(ticket) };
    const update = {
      $setOnInsert: {
        userId:             auth.userId,
        accountId:          account._id,
        externalId:         String(ticket),
        source:             'metatrader',
        symbol:             symbol.toUpperCase(),
        direction,
        assetClass:         guessAssetClass(symbol),
        entryDate:          new Date(time),
        entryPrice:         Number(price),
        quantity:           Number(lots),
        stopLoss:           sl != null ? Number(sl) : null,
        takeProfit:         tp != null ? Number(tp) : null,
        fees,
        status:             'open',
        brokerAccountLabel: auth.token.label,
      },
    };

    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
    const trade = await Trade.findOneAndUpdate(filter, update, opts);

    return res.status(200).json({ success: true, data: { id: trade._id } });
  }

  // ─── trade_close ──────────────────────────────────────────────────────────
  if (event === 'trade_close') {
    const trade = await Trade.findOne({ userId: auth.userId, externalId: String(ticket) });
    if (!trade) {
      // EA might have missed the open event — create a full record anyway
      const entryForClose = Number(price);  // best we have if open was missed
      const exitPrice     = Number(close_price);
      const quantity      = Number(lots);
      const pnl           = computePnl({ direction, entryPrice: entryForClose, exitPrice, quantity, fees });
      const rMultiple     = computeRMultiple({ pnl, entryPrice: entryForClose, stopLoss: sl, quantity });

      const newTrade = await Trade.create({
        userId:             auth.userId,
        accountId:          account._id,
        externalId:         String(ticket),
        source:             'metatrader',
        symbol:             symbol.toUpperCase(),
        direction,
        assetClass:         guessAssetClass(symbol),
        entryDate:          new Date(time),
        exitDate:           new Date(close_time),
        entryPrice:         entryForClose,
        exitPrice,
        quantity,
        stopLoss:           sl != null ? Number(sl) : null,
        takeProfit:         tp != null ? Number(tp) : null,
        fees,
        status:             'closed',
        pnl,
        rMultiple,
        brokerAccountLabel: auth.token.label,
      });

      crossCheckProfit(newTrade._id, pnl, brokerProfit);
      return res.status(200).json({ success: true, data: { id: newTrade._id } });
    }

    // Update the existing open trade
    trade.exitDate  = new Date(close_time);
    trade.exitPrice = Number(close_price);
    trade.status    = 'closed';
    // fees on close might include swap — add to existing fees
    trade.fees      = (trade.fees || 0) + fees;
    await trade.save(); // pre-save hook recomputes pnl / rMultiple

    crossCheckProfit(trade._id, trade.pnl, brokerProfit);
    return res.status(200).json({ success: true, data: { id: trade._id } });
  }
};

// ─── Cross-check broker profit vs computed P&L ────────────────────────────────

function crossCheckProfit(tradeId, computedPnl, brokerProfit) {
  if (brokerProfit == null || computedPnl == null) return;
  const diff = Math.abs(computedPnl - Number(brokerProfit));
  if (diff > 0.01) {
    console.warn(
      `[MT bridge] P&L mismatch on trade ${tradeId}: ` +
      `computed=${computedPnl.toFixed(4)}, broker=${Number(brokerProfit).toFixed(4)}, ` +
      `diff=${diff.toFixed(4)} — likely swap/commission timing.`
    );
  }
}

// ─── Asset-class heuristic ────────────────────────────────────────────────────

const FOREX_RE  = /^[A-Z]{6}(\..*)?$/;
const CRYPTO_RE = /BTC|ETH|XRP|LTC|BNB|SOL|DOGE|ADA|DOT/i;
const FUTURES_RE = /^[A-Z]+[0-9]{2}$/;

function guessAssetClass(symbol) {
  const s = symbol.toUpperCase();
  if (CRYPTO_RE.test(s)) return 'crypto';
  if (FUTURES_RE.test(s)) return 'futures';
  if (FOREX_RE.test(s))  return 'forex';
  return 'stock';
}


// ─── Token CRUD used by the settings UI (JWT-protected endpoints) ─────────────

/** GET /api/integrations/tokens — list all active tokens for this user */
exports.listTokens = async (req, res, next) => {
  try {
    const tokens = await IntegrationToken.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .select('-tokenHash');
    return sendSuccess(res, 200, tokens);
  } catch (err) { next(err); }
};

/** POST /api/integrations/tokens — create a new token, return raw once */
exports.createToken = async (req, res, next) => {
  try {
    const { label = 'MetaTrader Terminal' } = req.body;
    const raw  = crypto.randomBytes(32).toString('hex'); // 64-char hex
    const hash = hashToken(raw);

    const token = await IntegrationToken.create({
      userId:    req.user.id,
      tokenHash: hash,
      label,
    });

    // Return the raw token once — it will never be retrievable again.
    return sendSuccess(res, 201, {
      id:        token._id,
      label:     token.label,
      token:     raw,          // ← only time raw token is visible
      createdAt: token.createdAt,
    }, 'Token created. Copy it now — it will not be shown again.');
  } catch (err) { next(err); }
};

/** DELETE /api/integrations/tokens/:id — revoke a token */
exports.revokeToken = async (req, res, next) => {
  try {
    const token = await IntegrationToken.findOne({ _id: req.params.id, userId: req.user.id });
    if (!token) return sendError(res, 404, 'Token not found.', 'NOT_FOUND');

    token.revokedAt = new Date();
    await token.save();

    return sendSuccess(res, 200, null, 'Token revoked.');
  } catch (err) { next(err); }
};

/** POST /api/integrations/tokens/:id/regenerate — revoke old, issue new */
exports.regenerateToken = async (req, res, next) => {
  try {
    const old = await IntegrationToken.findOne({ _id: req.params.id, userId: req.user.id });
    if (!old) return sendError(res, 404, 'Token not found.', 'NOT_FOUND');

    // Revoke old
    old.revokedAt = new Date();
    await old.save();

    // Create new with same label
    const raw  = crypto.randomBytes(32).toString('hex');
    const hash = hashToken(raw);
    const token = await IntegrationToken.create({
      userId:    req.user.id,
      tokenHash: hash,
      label:     old.label,
    });

    return sendSuccess(res, 201, {
      id:        token._id,
      label:     token.label,
      token:     raw,
      createdAt: token.createdAt,
    }, 'Token regenerated. Copy the new token — it will not be shown again.');
  } catch (err) { next(err); }
};
