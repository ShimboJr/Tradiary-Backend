/**
 * utils/response.js
 * Centralised helpers for the consistent JSON response envelope.
 *
 *  Success:  { success: true,  data: <payload>, message: <optional> }
 *  Error:    { success: false, error: { message, code } }
 */

/**
 * @param {import('express').Response} res
 * @param {number} status - HTTP status code
 * @param {*} data - Response payload
 * @param {string} [message] - Optional human-readable message
 */
const sendSuccess = (res, status = 200, data = null, message = '') => {
  return res.status(status).json({
    success: true,
    ...(message && { message }),
    data,
  });
};

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} message
 * @param {string} [code]
 */
const sendError = (res, status = 500, message = 'Internal server error.', code = 'INTERNAL_ERROR') => {
  return res.status(status).json({
    success: false,
    error: { message, code },
  });
};

module.exports = { sendSuccess, sendError };
