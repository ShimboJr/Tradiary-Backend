/**
 * server.js — Entry point
 * Starts the HTTP server immediately, then connects to MongoDB.
 * This allows health-check probes to respond before the DB is ready,
 * which is the correct pattern for containerised / cloud deployments.
 */

require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;

// ─── Start HTTP server immediately ────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[server] 🚀  Tradiary API running on port ${PORT} — ${process.env.NODE_ENV}`);
});

// ─── Connect to MongoDB (non-blocking relative to HTTP) ───────────────────────
connectDB().catch((err) => {
  console.error('[server] Fatal DB error:', err.message);
  process.exit(1);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`\n[server] ${signal} received — shutting down gracefully…`);
  server.close(() => {
    console.log('[server] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Uncaught exception safety net
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled Rejection:', reason);
  process.exit(1);
});

