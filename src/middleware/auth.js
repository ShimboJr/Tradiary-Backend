/**
 * middleware/auth.js  (replaced from scaffold)
 * requireAuth — verifies JWT access token and attaches req.user.
 * optionalAuth — same but doesn't fail if no token (for public+private shared routes).
 */

const { verifyAccessToken } = require('../utils/tokens');
const { sendError } = require('../utils/response');

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'Authentication required.', 'UNAUTHORIZED');
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendError(res, 401, 'Access token expired.', 'TOKEN_EXPIRED');
    }
    return sendError(res, 401, 'Invalid access token.', 'INVALID_TOKEN');
  }
};

const optionalAuth = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      req.user = verifyAccessToken(authHeader.split(' ')[1]);
    } catch {
      // ignore — route handles unauthenticated case
    }
  }
  next();
};

module.exports = { requireAuth, optionalAuth };
