/**
 * jobs/weeklyNotification.js
 * node-cron job: every Sunday at 08:00 UTC, compute each user's weekly
 * trading summary and insert a notification.
 */

'use strict';

const cron         = require('node-cron');
const User         = require('../models/User');
const Trade        = require('../models/Trade');
const Notification = require('../models/Notification');

/**
 * Registers the cron job. Call once at server startup.
 * Only runs in production to avoid spam in development.
 */
function registerWeeklySummaryJob() {
  // Sunday 08:00 UTC → '0 8 * * 0'
  const schedule = process.env.WEEKLY_SUMMARY_CRON || '0 8 * * 0';

  cron.schedule(schedule, async () => {
    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
      console.log('[cron] Weekly summary: skipped (NODE_ENV !== production)');
      return;
    }

    console.log('[cron] Running weekly summary notifications…');
    const now  = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    from.setHours(0, 0, 0, 0);

    try {
      const users = await User.find({}, '_id name').lean();

      for (const user of users) {
        try {
          const trades = await Trade.find({
            userId:    user._id,
            status:    'closed',
            entryDate: { $gte: from, $lte: now },
          }).lean();

          if (trades.length === 0) continue;

          const winners   = trades.filter(t => t.pnl > 0).length;
          const winRate   = ((winners / trades.length) * 100).toFixed(0);
          const netPnl    = trades.reduce((s, t) => s + (t.pnl || 0), 0);
          const pnlSign   = netPnl >= 0 ? '+' : '';
          const pnlStr    = `${pnlSign}${netPnl.toFixed(2)}`;

          await Notification.create({
            userId: user._id,
            type:   'weekly_summary',
            title:  `Your weekly summary is ready`,
            body:   `${trades.length} trades · Win rate ${winRate}% · Net P&L ${pnlStr}`,
            linkTo: '/app/dashboard',
          });
        } catch (userErr) {
          console.error(`[cron] Weekly summary failed for user ${user._id}:`, userErr.message);
        }
      }

      console.log(`[cron] Weekly summary: sent notifications to ${users.length} users.`);
    } catch (err) {
      console.error('[cron] Weekly summary job error:', err.message);
    }
  }, { timezone: 'UTC' });

  console.log(`[cron] Weekly summary scheduled: "${schedule}" (UTC)`);
}

module.exports = { registerWeeklySummaryJob };
