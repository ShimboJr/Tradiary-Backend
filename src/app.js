/**
 * app.js
 * Express application factory.
 * Security middleware, body parsing, CORS, routes, and error handler are
 * all wired here so server.js stays thin (just starts listening).
 */

'use strict';

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const { globalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const apiRouter    = require('./routes/index');
const { registerWeeklySummaryJob }    = require('./jobs/weeklyNotification');
const { registerOrphanedTradeJob }    = require('./jobs/resolveOrphanedTrades');

const app  = express();
const isProd = process.env.NODE_ENV === 'production';

// ─── Trust Proxy ──────────────────────────────────────────────────────────────
// Render (and most PaaS/CDN hosts) sit behind a reverse proxy that injects
// X-Forwarded-For. Without this, express-rate-limit throws a fatal
// ValidationError (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR) that crashes the
// entire Node process, taking the server down for all users.
// '1' means trust exactly one hop (the Render load-balancer).
app.set('trust proxy', 1);

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (mobile apps, curl, health checks)
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tradiary-Token'],
  })
);

// ─── Logging (verbose in dev, minimal in prod) ────────────────────────────────
if (isProd) {
  // Minimal Apache-style — only logs status + response time
  app.use(morgan('tiny'));
} else {
  app.use(morgan('dev'));
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────
app.use(globalLimiter);

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Cookie Parser ────────────────────────────────────────────────────────────
app.use(require('cookie-parser')());

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ─── 404 Catch-all ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { message: `Route ${req.method} ${req.originalUrl} not found.`, code: 'NOT_FOUND' },
  });
});

// ─── Global Error Handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ─── Background Jobs ──────────────────────────────────────────────────────────
// Register cron jobs after all middleware is set up
registerWeeklySummaryJob();
registerOrphanedTradeJob();

module.exports = app;
