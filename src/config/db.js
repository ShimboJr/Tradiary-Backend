/**
 * config/db.js
 * MongoDB connection with connection pooling, retry logic, and graceful teardown.
 */

const mongoose = require('mongoose');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

const connectDB = async (attempt = 1) => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 10,          // maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log(`[db] ✅  MongoDB connected — host: ${conn.connection.host}`);

    mongoose.connection.on('disconnected', () => {
      console.warn('[db] ⚠️  MongoDB disconnected — attempting reconnect…');
    });

    mongoose.connection.on('error', (err) => {
      console.error('[db] ❌  MongoDB error:', err.message);
    });

    // Graceful close when Node process ends
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('[db] MongoDB connection closed (SIGINT).');
    });
    process.on('SIGTERM', async () => {
      await mongoose.connection.close();
      console.log('[db] MongoDB connection closed (SIGTERM).');
    });
  } catch (err) {
    console.error(`[db] ❌  Connection failed (attempt ${attempt}/${MAX_RETRIES}):`, err.message);

    if (attempt < MAX_RETRIES) {
      console.log(`[db] Retrying in ${RETRY_DELAY_MS / 1000}s…`);
      await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
      return connectDB(attempt + 1);
    }

    console.error('[db] Max retries reached. Exiting.');
    process.exit(1);
  }
};

module.exports = connectDB;
