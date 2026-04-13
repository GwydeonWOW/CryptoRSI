/**
 * Crypto Data API Clients
 *
 * Primary:   Binance API (free, no auth, full OHLCV)
 * Fallback:  CryptoCompare API (free tier)
 * Fallback2: CoinCap API (free, no auth)
 *
 * Includes in-memory cache to reduce API calls.
 */

const fetch = require('node-fetch');

const BINANCE_BASE = 'https://api.binance.com';
const CRYPTOCOMPARE_BASE = 'https://min-api.cryptocompare.com/data';
const COINCAP_BASE = 'https://api.coincap.io/v2';

// Binance interval mapping
const BINANCE_INTERVALS = {
  '1h': '1h',
  '4h': '4h',
  '1d': '1d'
};

// Number of candles to fetch per timeframe
const CANDLE_LIMIT = 100;

// ============================================================
// In-memory cache (avoids hammering APIs on every refresh)
// ============================================================

const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ============================================================
// Binance
// ============================================================

async function fetchBinanceCandles(symbol, interval, limit = CANDLE_LIMIT) {
  const binanceSymbol = symbol.toUpperCase().includes('USDT')
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'CryptoRSI/1.0' }
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.code) {
    throw new Error(`Binance error: ${data.msg || data.code}`);
  }

  return data.map(k => ({
    timestamp: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6]
  }));
}

// ============================================================
// CryptoCompare
// ============================================================

async function fetchCryptoCompareCandles(symbol, timeframe, limit = CANDLE_LIMIT) {
  const upperSymbol = symbol.toUpperCase().replace('USDT', '').replace('USD', '');
  const endpoint = timeframe === '1d' ? 'histoday' : timeframe === '4h' ? 'histohour' : 'histohour';

  const url = `${CRYPTOCOMPARE_BASE}/${endpoint}?fsym=${upperSymbol}&tsym=USDT&limit=${limit}${timeframe === '4h' ? '&aggregate=4' : ''}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'CryptoRSI/1.0' }
  });

  if (!response.ok) {
    throw new Error(`CryptoCompare API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.Response === 'Error') {
    throw new Error(`CryptoCompare error: ${data.Message}`);
  }

  return (data.Data || []).map(d => ({
    timestamp: d.time * 1000,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volumeto
  }));
}

// ============================================================
// CoinCap (third fallback - free, no auth, good altcoin coverage)
// ============================================================

async function fetchCoinCapCandles(symbol, timeframe) {
  // CoinCap uses asset IDs (lowercase, e.g. "bitcoin", "ethereum")
  // We'll try the symbol directly first, then try a lookup
  const upper = symbol.toUpperCase().replace('USDT', '').replace('USD', '');

  // Map common symbols to CoinCap IDs
  const symbolToId = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
    'BNB': 'binance-coin', 'ADA': 'cardano', 'XRP': 'xrp',
    'DOGE': 'dogecoin', 'DOT': 'polkadot', 'MATIC': 'polygon',
    'AVAX': 'avalanche', 'LINK': 'chainlink', 'UNI': 'uniswap',
    'ATOM': 'cosmos', 'LTC': 'litecoin', 'NEAR': 'near-protocol',
    'APT': 'aptos', 'ARB': 'arbitrum', 'OP': 'optimism',
    'SUI': 'sui', 'SEI': 'sei-network', 'TIA': 'celestia',
    'INJ': 'injective-protocol', 'FIL': 'filecoin', 'IMX': 'immutable-x',
    'HBAR': 'hedera-hashgraph', 'ICP': 'internet-computer',
    'FET': 'fetch-ai', 'RENDER': 'render-token', 'AAVE': 'aave',
    'MKR': 'maker', 'SNX': 'havven', 'PENDLE': 'pendle',
    'JUP': 'jupiter-exchange-solana', 'WIF': 'dogwifcoin',
    'BONK': 'bonk', 'PEPE': 'pepe', 'FLOKI': 'floki',
    'SHIB': 'shiba-inu', 'FTM': 'fantom', 'GRT': 'the-graph',
    'ALGO': 'algorand', 'VET': 'vechain', 'SAND': 'the-sandbox',
    'MANA': 'decentraland', 'CRV': 'curve-dao-token',
    'LDO': 'lido-dao', 'RPL': 'rocket-pool', 'BLUR': 'blur',
    'DYDX': 'dydx', 'GMX': 'gmx', 'COMP': 'compound-governance-token',
    '1INCH': '1inch', 'ENS': 'ethereum-name-service',
    'LRC': 'loopring', 'KNC': 'kyber-network', 'ZRX': '0x'
  };

  const assetId = symbolToId[upper] || upper.toLowerCase();

  // CoinCap candle intervals: m1, m5, m15, m30, h1, h2, h6, h12, d1
  const intervalMap = {
    '1h': 'h1',
    '4h': 'h6',
    '1d': 'd1'
  };
  const interval = intervalMap[timeframe] || 'd1';

  // Fetch last 24h of data depending on timeframe
  const now = Date.now();
  let start;
  if (timeframe === '1h') start = now - 100 * 60 * 60 * 1000;        // 100 hours
  else if (timeframe === '4h') start = now - 100 * 4 * 60 * 60 * 1000; // 100 four-hours
  else start = now - 100 * 24 * 60 * 60 * 1000;                        // 100 days

  const url = `${COINCAP_BASE}/assets/${assetId}/history?interval=${interval}&start=${start}&end=${now}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'CryptoRSI/1.0' }
  });

  if (!response.ok) {
    throw new Error(`CoinCap API error: ${response.status}`);
  }

  const result = await response.json();

  if (!result.data || result.data.length === 0) {
    throw new Error(`CoinCap: no data for ${symbol}`);
  }

  return result.data.map(d => ({
    timestamp: d.time,
    open: parseFloat(d.priceOpen) || parseFloat(d.price),
    high: parseFloat(d.priceHigh) || parseFloat(d.price),
    low: parseFloat(d.priceLow) || parseFloat(d.price),
    close: parseFloat(d.price),
    volume: parseFloat(d.volume) || 0
  }));
}

// ============================================================
// Unified fetch with 3-API fallback + cache
// ============================================================

async function fetchCandles(symbol, timeframe = '1d') {
  const cacheKey = `candles:${symbol}:${timeframe}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const interval = BINANCE_INTERVALS[timeframe] || '1d';
  let result = null;

  // 1) Try Binance
  try {
    const candles = await fetchBinanceCandles(symbol, interval);
    if (candles && candles.length > 15) {
      result = { candles, source: 'binance' };
    }
  } catch (e) {
    console.log(`Binance failed for ${symbol}: ${e.message}`);
  }

  // 2) Try CoinCap (free, good for altcoins Binance doesn't have)
  if (!result) {
    try {
      const candles = await fetchCoinCapCandles(symbol, timeframe);
      if (candles && candles.length > 15) {
        result = { candles, source: 'coincap' };
      }
    } catch (e) {
      console.log(`CoinCap failed for ${symbol}: ${e.message}`);
    }
  }

  // 3) Try CryptoCompare (rate-limited, last resort)
  if (!result) {
    try {
      const candles = await fetchCryptoCompareCandles(symbol, timeframe);
      if (candles && candles.length > 15) {
        result = { candles, source: 'cryptocompare' };
      }
    } catch (e) {
      console.log(`CryptoCompare also failed for ${symbol}: ${e.message}`);
    }
  }

  if (!result) {
    throw new Error(`No data available for ${symbol} on any API`);
  }

  setCache(cacheKey, result);
  return result;
}

// ============================================================
// Current price with 3-API fallback + cache
// ============================================================

async function fetchCurrentPrice(symbol) {
  const cacheKey = `price:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const binanceSymbol = symbol.toUpperCase().includes('USDT')
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  // 1) Binance
  try {
    const url = `${BINANCE_BASE}/api/v3/ticker/price?symbol=${binanceSymbol}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });
    const data = await res.json();
    if (data.price) {
      const result = { price: parseFloat(data.price), source: 'binance' };
      setCache(cacheKey, result);
      return result;
    }
  } catch (e) { /* next */ }

  // 2) CoinCap
  try {
    const upper = symbol.toUpperCase().replace('USDT', '').replace('USD', '');
    const symbolToId = {
      'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
      'BNB': 'binance-coin', 'ADA': 'cardano', 'XRP': 'xrp',
      'DOGE': 'dogecoin', 'DOT': 'polkadot', 'MATIC': 'polygon',
      'AVAX': 'avalanche', 'LINK': 'chainlink'
    };
    const assetId = symbolToId[upper] || upper.toLowerCase();
    const url = `${COINCAP_BASE}/assets/${assetId}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });
    const data = await res.json();
    if (data.data && data.data.priceUsd) {
      const result = { price: parseFloat(data.data.priceUsd), source: 'coincap' };
      setCache(cacheKey, result);
      return result;
    }
  } catch (e) { /* next */ }

  // 3) CryptoCompare (rate-limited)
  try {
    const upperSymbol = symbol.toUpperCase().replace('USDT', '').replace('USD', '');
    const url = `${CRYPTOCOMPARE_BASE}/price?fsym=${upperSymbol}&tsyms=USDT`;
    const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });
    const data = await res.json();
    if (data.USDT) {
      const result = { price: data.USDT, source: 'cryptocompare' };
      setCache(cacheKey, result);
      return result;
    }
  } catch (e) {}

  return { price: null, source: null };
}

module.exports = { fetchCandles, fetchCurrentPrice };
