/**
 * services/marketData.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified market-data abstraction.
 * Consumers call: getCandles({ symbol, assetClass, timeframe, from, to })
 *   → Promise<[{ time, open, high, low, close }]>
 *
 * Symbol normalisation pipeline (applied automatically):
 *   1. Strip broker-specific suffixes  (.S  .m  .pro  .micro  etc.)
 *   2. Map to provider-specific ticker (XAUUSD → GC=F, USDJPY → USDJPY=X …)
 *
 * Provider routing:
 *   • MARKET_DATA_PROVIDER=yahoo  (default) → Yahoo Finance for everything
 *   • MARKET_DATA_PROVIDER=binance          → Binance for everything
 *   • assetClass='crypto' + default         → auto-route to Binance
 */

'use strict';

const fetch = require('node-fetch');

// ─── Symbol normalisation ─────────────────────────────────────────────────────

/**
 * Strip common broker / platform suffixes added by MetaTrader, cTrader, etc.
 * Examples: BTCUSD.S → BTCUSD, USDJPY.m → USDJPY, EURUSD.pro → EURUSD
 */
function stripBrokerSuffix(symbol) {
  return symbol
    .trim()
    .toUpperCase()
    // Remove trailing dot-suffixes that brokers append (.S .m .c .r .z .pro .micro .stp .ecn .raw .std .nb)
    .replace(/\.(S|m|micro|mini|pro|c|r|z|stp|ecn|raw|std|nb|nk|uk|us|eu)$/i, '')
    // Remove trailing digits that some brokers add (EURUSD1, GBPUSD2 …)
    .replace(/\d+$/, '')
    .trim();
}

/**
 * Yahoo Finance symbol map.
 * Covers the most common symbols that don't map directly to a Yahoo ticker.
 * Add more here as needed — the rest of the code never needs to change.
 */
const YAHOO_SYMBOL_MAP = {
  // ── Metals ──────────────────────────────────────────────────────────────────
  XAUUSD: 'GC=F',      // Gold
  XAGUSD: 'SI=F',      // Silver
  XPTUSD: 'PL=F',      // Platinum
  XPDUSD: 'PA=F',      // Palladium

  // ── Energy ──────────────────────────────────────────────────────────────────
  USOIL:  'CL=F',      // WTI Crude Oil
  XTIUSD: 'CL=F',
  XBRUSD: 'BZ=F',      // Brent Crude
  UKOIL:  'BZ=F',
  NATGAS: 'NG=F',

  // ── Indices ─────────────────────────────────────────────────────────────────
  US30:   'YM=F',      // Dow Jones futures
  US500:  'ES=F',      // S&P 500 futures
  SPX500: 'ES=F',
  SPXUSD: 'ES=F',
  NAS100: 'NQ=F',      // Nasdaq-100 futures
  NASUSD: 'NQ=F',
  UK100:  'Z=F',       // FTSE 100 futures
  GER40:  'FDAX.F',    // DAX
  GER30:  'FDAX.F',
  JPN225: 'NKD=F',     // Nikkei 225 futures
  AUS200: '^AXJO',     // ASX 200

  // ── Crypto (Yahoo format) ────────────────────────────────────────────────────
  BTCUSD: 'BTC-USD',
  ETHUSD: 'ETH-USD',
  LTCUSD: 'LTC-USD',
  XRPUSD: 'XRP-USD',
  BNBUSD: 'BNB-USD',
  ADAUSD: 'ADA-USD',
  SOLUSD: 'SOL-USD',
  DOTUSD: 'DOT-USD',
  DOGEUSD:'DOGE-USD',
  MATICUSD:'MATIC-USD',
  LINKUSD:'LINK-USD',
  AVAXUSD:'AVAX-USD',
};

/**
 * Convert a normalised symbol to the correct Yahoo Finance ticker.
 * Forex pairs get `=X` appended; everything else goes through the map or as-is.
 */
function toYahooSymbol(symbol, assetClass) {
  // Check explicit map first
  if (YAHOO_SYMBOL_MAP[symbol]) return YAHOO_SYMBOL_MAP[symbol];

  // Forex pattern: exactly 6 uppercase letters (EURUSD, GBPUSD, USDJPY …)
  // or asset class is forex
  if (assetClass === 'forex' || (assetClass !== 'stock' && /^[A-Z]{6}$/.test(symbol))) {
    return `${symbol}=X`;
  }

  // Crypto not in the explicit map: try Yahoo crypto format (XXXUSD → XXX-USD)
  if (assetClass === 'crypto') {
    const base = symbol.replace(/USD$/, '');
    if (base && base !== symbol) return `${base}-USD`;
  }

  // Stocks, ETFs: use as-is (AAPL, MSFT, SPY …)
  return symbol;
}

/**
 * Convert a normalised symbol to the Binance ticker.
 * Binance uses XXXUSDT for most USD-quoted pairs.
 */
function toBinanceSymbol(symbol) {
  // If it already ends in USDT / BUSD / BTC use as-is
  if (/USDT$|BUSD$|BTC$|ETH$|BNB$/.test(symbol)) return symbol;
  // If it ends in USD → swap for USDT
  if (symbol.endsWith('USD')) return `${symbol.slice(0, -3)}USDT`;
  return symbol;
}

// ─── Provider implementations ─────────────────────────────────────────────────

async function fetchBinance(rawSymbol, interval, from, to) {
  const sym = toBinanceSymbol(rawSymbol);

  const params = new URLSearchParams({
    symbol:    sym,
    interval,
    startTime: from,      // ms
    endTime:   to,        // ms
    limit:     1000,
  });

  const url = `https://api.binance.com/api/v3/klines?${params}`;
  const res = await fetch(url, { timeout: 15000 });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Binance error ${res.status} for ${sym}: ${body.slice(0, 200)}`);
  }

  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Binance: no candle data returned for ${sym}`);
  }

  return raw.map(k => ({
    time:  Math.floor(k[0] / 1000), // seconds
    open:  parseFloat(k[1]),
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}

async function fetchYahoo(rawSymbol, assetClass, interval, fromMs, toMs) {
  const sym = toYahooSymbol(rawSymbol, assetClass);
  const period1 = Math.floor(fromMs / 1000);
  const period2 = Math.floor(toMs   / 1000);

  const params = new URLSearchParams({ interval, period1, period2, events: 'history' });
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${params}`;

  const res = await fetch(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Tradiary/1.0)',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Yahoo Finance error ${res.status} for ${sym}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();

  // Yahoo wraps errors as 200 with chart.error set
  const chartError = json?.chart?.error;
  if (chartError) {
    throw new Error(`Yahoo Finance error for ${sym}: ${chartError.description || chartError.code}`);
  }

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo Finance: empty chart result for ${sym}`);

  const timestamps = result.timestamp || [];
  const q          = result.indicators?.quote?.[0] || {};

  if (!timestamps.length) {
    throw new Error(`Yahoo Finance: no candle data returned for ${sym} at ${interval}. ` +
      'Note: Yahoo intraday (1m/5m) data is only available for the last 7/60 days.');
  }

  return timestamps
    .map((t, i) => ({
      time:  t,
      open:  +(q.open?.[i]  ?? 0).toFixed(8),
      high:  +(q.high?.[i]  ?? 0).toFixed(8),
      low:   +(q.low?.[i]   ?? 0).toFixed(8),
      close: +(q.close?.[i] ?? 0).toFixed(8),
    }))
    .filter(c => c.open !== 0 && c.high !== 0 && c.low !== 0 && c.close !== 0);
}

// ─── Timeframe maps ───────────────────────────────────────────────────────────

const BINANCE_INTERVAL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '1d': '1d' };
const YAHOO_INTERVAL   = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '1d': '1d' };

// ─── Provider selector ────────────────────────────────────────────────────────

function selectProvider(assetClass) {
  const override = (process.env.MARKET_DATA_PROVIDER || 'yahoo').toLowerCase();
  if (override === 'binance') return 'binance';
  if (override === 'yahoo')   return 'yahoo';
  return assetClass === 'crypto' ? 'binance' : 'yahoo';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * getCandles – single entry-point for the rest of the app.
 *
 * @param {object} opts
 * @param {string} opts.symbol       Ticker (any broker format — will be normalised)
 * @param {string} opts.assetClass   'crypto' | 'stock' | 'forex' | 'futures' | 'options'
 * @param {string} opts.timeframe    '1m' | '5m' | '15m' | '1h' | '1d'
 * @param {number} opts.from         Unix milliseconds
 * @param {number} opts.to           Unix milliseconds
 * @returns {Promise<Array<{time,open,high,low,close}>>}
 */
async function getCandles({ symbol, assetClass, timeframe, from, to }) {
  const sym      = stripBrokerSuffix(symbol);
  const provider = selectProvider(assetClass);

  if (provider === 'binance') {
    const interval = BINANCE_INTERVAL[timeframe];
    if (!interval) throw new Error(`Binance: unsupported timeframe "${timeframe}"`);
    return fetchBinance(sym, interval, from, to);
  }

  const interval = YAHOO_INTERVAL[timeframe];
  if (!interval) throw new Error(`Yahoo Finance: unsupported timeframe "${timeframe}"`);
  return fetchYahoo(sym, assetClass, interval, from, to);
}

module.exports = { getCandles };
