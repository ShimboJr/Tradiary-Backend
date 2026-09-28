/**
 * middleware/errorHandler.js
 * Global error-handling middleware.
 * All errors thrown/next(err)'d bubble up here and are returned as a
 * consistent JSON envelope:  { success: false, error: { message, code?, stack? } }
 */

const errorHandler = (err, req, res, _next) => {
  const isDev = process.env.NODE_ENV === 'development';

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      error: { message: messages.join(', '), code: 'VALIDATION_ERROR' },
    });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      error: { message: `${field} already exists.`, code: 'DUPLICATE_KEY' },
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: { message: 'Invalid token.', code: 'INVALID_TOKEN' },
    });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: { message: 'Token expired.', code: 'TOKEN_EXPIRED' },
    });
  }

  // Operational / generic
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error.';

  console.error(`[error] ${status} — ${message}`, isDev ? err.stack : '');

  return res.status(status).json({
    success: false,
    error: {
      message,
      code: err.code || 'INTERNAL_ERROR',
      ...(isDev && { stack: err.stack }),
    },
  });
};

module.exports = errorHandler;
