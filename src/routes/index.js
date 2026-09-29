/**
 * routes/index.js
 * Central router — mounts all feature routers under /api.
 */

const express = require('express');
const healthRouter   = require('./health');
const authRouter     = require('./auth');
const accountsRouter = require('./accounts');
const tradesRouter   = require('./trades');
const uploadsRouter  = require('./uploads');
const analyticsRouter= require('./analytics');

const router = express.Router();

router.use('/health',    healthRouter);
router.use('/auth',      authRouter);
router.use('/accounts',  accountsRouter);
router.use('/trades',    tradesRouter);
router.use('/uploads',   uploadsRouter);
router.use('/analytics', analyticsRouter);

module.exports = router;
