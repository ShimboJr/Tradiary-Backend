/**
 * services/marketData.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified market-data abstraction.
 * Consumers call: getCandles({ symbol, assetClass, timeframe, from, to })
 *   → Promise<[{ time, open, high, low, close }]>
 *
 * Provider routing:
 *   • assetClass === 'crypto'          → Binance REST  (public, keyless)
 *   • everything else                  → Yahoo Finance (unofficial, keyless)
 *   • MARKET_DATA_PROVIDER=yahoo       forces Yahoo for all (default)
 *   • MARKET_DATA_PROVIDER=binance     forces Binance for all
 *
 * Adding a new provider later: implement the same signature below, export,
 * and wire it in selectProvider() — nothing else changes.
 */

'use strict';

const fetch = require('node-fetch');

// ─── Provider implementations ─────────────────────────────────────────────────

/**
 * Binance public klines endpoint.
 * Docs: https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data
 *
 * @param {string} symbol  e.g. "BTCUSDT" or "BTC/USDT" → normalised to "BTCUSDT"
 * @param {string} interval  Binance interval string: "1m","5m","15m","1h","1d"
 * @param {number} from  Unix ms
 * @param {number} to    Unix ms
 * @returns {Promise<Array<{time,open,high,low,close}>>}
 */
async function fetchBinance(symbol, interval, from, to) {
  // Normalise symbol: strip / or - separators
  const sym = symbol.replace(/[^A-Z0-9]/gi, '').toUpperCase();

  const params = new URLSearchParams({
    symbol:    sym,
    interval,
    startTime: from,
    endTime:   to,
    limit:     1000,
  });

  const url = `https://api.binance.com/api/v3/klines?${params}`;
  const res  = await fetch(url, { timeout: 15000 });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Binance error ${res.status}: ${body.slice(0, 200)}`);
  }

  const raw = await res.json();

  // Binance kline: [openTime, open, high, low, close, volume, ...]
  return raw.map(k => ({
    time:  Math.floor(k[0] / 1000), // seconds (lightweight-charts expects seconds)
    open:  parseFloat(k[1]),
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}

/**
 * Yahoo Finance unofficial chart endpoint.
 * Widely used by yfinance and many open-source tools.
 * ⚠ Not officially supported; can change or rate-limit at any time.
 * Caller must handle failures gracefully — this fn throws, caller wraps.
 *
 * @param {string} symbol  Yahoo ticker, e.g. "EURUSD=X", "AAPL", "^GSPC"
 * @param {string} interval  Yahoo interval: "1m","5m","1h","1d"
 * @param {number} from  Unix seconds
 * @param {number} to    Unix seconds
 */
async function fetchYahoo(symbol, interval, from, to) {
  const params = new URLSearchParams({
    interval,
    period1: Math.floor(from / 1000),
    period2: Math.floor(to   / 1000),
    events:  'history',
  });

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;

  const res = await fetch(url, {
    timeout: 15000,
    headers: {
      // Yahoo sometimes 429s bare Node user-agents; mimic a browser enough to pass
      'User-Agent': 'Mozilla/5.0 (compatible; Tradiary/1.0)',
      Accept:       'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Yahoo Finance error ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo Finance: empty chart result');

  const timestamps = result.timestamp || [];
  const q          = result.indicators?.quote?.[0] || {};

  if (!timestamps.length) throw new Error('Yahoo Finance: no candle data returned');

  return timestamps.map((t, i) => ({
    time:  t,                                       // already in seconds
    open:  +(q.open?.[i]  ?? 0).toFixed(8),
    high:  +(q.high?.[i]  ?? 0).toFixed(8),
    low:   +(q.low?.[i]   ?? 0).toFixed(8),
    close: +(q.close?.[i] ?? 0).toFixed(8),
  })).filter(c => c.open && c.high && c.low && c.close); // drop null slots
}

// ─── Timeframe normalisers ────────────────────────────────────────────────────

/**
 * Map our canonical timeframe string to Binance interval format.
 * Binance supports: 1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M
 */
const BINANCE_INTERVAL = {
  '1m':  '1m',
  '5m':  '5m',
  '15m': '15m',
  '1h':  '1h',
  '1d':  '1d',
};

/**
 * Map our canonical timeframe string to Yahoo interval format.
 * Yahoo supports: 1m 2m 5m 15m 30m 60m 90m 1h 1d 5d 1wk 1mo 3mo
 */
const YAHOO_INTERVAL = {
  '1m':  '1m',
  '5m':  '5m',
  '15m': '15m',
  '1h':  '1h',
  '1d':  '1d',
};

// ─── Provider selector ────────────────────────────────────────────────────────

function selectProvider(assetClass) {
  const override = (process.env.MARKET_DATA_PROVIDER || 'yahoo').toLowerCase();
  if (override === 'binance') return 'binance';
  if (override === 'yahoo')   return 'yahoo';
  // Auto-routing (future default when MARKET_DATA_PROVIDER is unset / 'auto')
  return assetClass === 'crypto' ? 'binance' : 'yahoo';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * getCandles – the single function the rest of the app uses.
 *
 * @param {object} opts
 * @param {string} opts.symbol       Ticker symbol
 * @param {string} opts.assetClass   'crypto' | 'stock' | 'forex' | 'futures' | 'options'
 * @param {string} opts.timeframe    '1m' | '5m' | '15m' | '1h' | '1d'
 * @param {number} opts.from         Range start — Unix milliseconds
 * @param {number} opts.to           Range end   — Unix milliseconds
 * @returns {Promise<Array<{time:number, open:number, high:number, low:number, close:number}>>}
 */
async function getCandles({ symbol, assetClass, timeframe, from, to }) {
  const provider = selectProvider(assetClass);

  if (provider === 'binance') {
    const interval = BINANCE_INTERVAL[timeframe];
    if (!interval) throw new Error(`Binance: unsupported timeframe "${timeframe}"`);
    return fetchBinance(symbol, interval, from, to);
  }

  // Default: Yahoo Finance
  const interval = YAHOO_INTERVAL[timeframe];
  if (!interval) throw new Error(`Yahoo Finance: unsupported timeframe "${timeframe}"`);
  return fetchYahoo(symbol, interval, from, to);
}

module.exports = { getCandles };
