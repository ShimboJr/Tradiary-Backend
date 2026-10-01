const express = require('express');
const healthRouter        = require('./health');
const authRouter          = require('./auth');
const accountsRouter      = require('./accounts');
const tradesRouter        = require('./trades');
const uploadsRouter       = require('./uploads');
const analyticsRouter     = require('./analytics');
const strategiesRouter    = require('./strategies');
const journalRouter       = require('./journal');
const goalsRouter         = require('./goals');
const watchlistRouter     = require('./watchlist');
const notificationsRouter = require('./notifications');
const usersRouter         = require('./users');
const reportsRouter       = require('./reports');
const integrationsRouter  = require('./integrations');

const router = express.Router();

router.use('/health',        healthRouter);
router.use('/auth',          authRouter);
router.use('/accounts',      accountsRouter);
router.use('/trades',        tradesRouter);
router.use('/uploads',       uploadsRouter);
router.use('/analytics',     analyticsRouter);
router.use('/strategies',    strategiesRouter);
router.use('/journal',       journalRouter);
router.use('/goals',         goalsRouter);
router.use('/watchlist',     watchlistRouter);
router.use('/notifications', notificationsRouter);
router.use('/users',         usersRouter);
router.use('/reports',       reportsRouter);
router.use('/integrations',  integrationsRouter);

module.exports = router;

