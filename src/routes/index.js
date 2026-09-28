/**
 * routes/index.js
 * Central router — mounts all feature routers under /api.
 */

const express = require('express');
const healthRouter = require('./health');
const authRouter   = require('./auth');
// Future routes:
// const tradesRouter = require('./trades');
// const usersRouter  = require('./users');

const router = express.Router();

router.use('/health', healthRouter);
router.use('/auth',   authRouter);
// router.use('/trades', tradesRouter);
// router.use('/users',  usersRouter);

module.exports = router;
