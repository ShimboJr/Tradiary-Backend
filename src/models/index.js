/**
 * models/index.js
 * Barrel export for all Mongoose models.
 */

const User             = require('./User');
const Account          = require('./Account');
const Trade            = require('./Trade');
const Strategy         = require('./Strategy');
const JournalEntry     = require('./JournalEntry');
const Goal             = require('./Goal');
const WatchlistItem    = require('./WatchlistItem');
const IntegrationToken = require('./IntegrationToken');
const CandleCache      = require('./CandleCache');

module.exports = { User, Account, Trade, Strategy, JournalEntry, Goal, WatchlistItem, IntegrationToken, CandleCache };
