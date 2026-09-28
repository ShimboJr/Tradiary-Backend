/**
 * controllers/healthController.js
 * Simple health-check — confirms the server is alive and MongoDB is connected.
 */

const mongoose = require('mongoose');
const { sendSuccess } = require('../utils/response');

const getHealth = (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

  return sendSuccess(res, 200, {
    status: 'ok',
    db: dbStatus,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};

module.exports = { getHealth };
