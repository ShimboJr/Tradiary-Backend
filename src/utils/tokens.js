/**
 * utils/tokens.js  (replaced from scaffold)
 * JWT token generation + verification + cookie helpers.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ─── Access Token ────────────────────────────────────────────────────────────

const generateAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });

const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_ACCESS_SECRET);

// ─── Refresh Token ───────────────────────────────────────────────────────────

/**
 * @param {{ id: string, tokenVersion: number }} payload
 */
const generateRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });

const verifyRefreshToken = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET);

// ─── Cookie helper ───────────────────────────────────────────────────────────

const REFRESH_COOKIE_NAME = 'tradiary_rt';

/**
 * Set the httpOnly refresh token cookie.
 * @param {import('express').Response} res
 * @param {string} token
 * @param {boolean} remember  true → 30d persistent cookie; false → session cookie
 */
const setRefreshCookie = (res, token, remember = true) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    // SameSite=None + Secure=true required for cross-origin cookie (Vercel ↔ Render).
    // In dev (localhost) use Lax + no Secure so it works without HTTPS.
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/api/auth/refresh', // scope cookie to the refresh endpoint only
    ...(remember ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}), // 30 days or session
  });
};

const clearRefreshCookie = (res) => {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/api/auth/refresh',
  });
};

// ─── One-time signed tokens (email verify / password reset) ─────────────────

/** Generate a random URL-safe token and its SHA-256 hash for storage. */
const generateOpaqueToken = () => {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
};

/** Hash a raw token (for comparison with stored hash). */
const hashOpaqueToken = (raw) =>
  crypto.createHash('sha256').update(raw).digest('hex');

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
  generateOpaqueToken,
  hashOpaqueToken,
};
