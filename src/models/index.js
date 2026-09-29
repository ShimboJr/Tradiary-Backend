/**
 * models/index.js
 * Barrel export for all Mongoose models.
 */

const User    = require('./User');
const Account = require('./Account');
const Trade   = require('./Trade');

module.exports = { User, Account, Trade };
