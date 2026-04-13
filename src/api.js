/**
 * Crypto Data API Clients
 *
 * Primary: Binance API (free, no auth, full OHLCV)
 * Fallback: CryptoCompare API (free tier, good coverage)
 */

const fetch = require('node-fetch');

const BINANCE_BASE = 'https://api.binance.com';
const CRYPTOCOMPARE_BASE = 'https://min-api.cryptocompare.com/data';

// Binance interval mapping
const BINANCE_INTERVALS = {
  '1h': '1h',
  '4h': '4h',
  '1d': '1d'
};

// Number of candles to fetch per timeframe
const CANDLE_LIMIT = 100;

/**
 * Fetch OHLCV candles from Binance
 */
async function fetchBinanceCandles(symbol, interval, limit = CANDLE_LIMIT) {
  // Convert common symbol formats to Binance format (e.g., BTC -> BTCUSDT)
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

  // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
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

/**
 * Fetch OHLCV candles from CryptoCompare (fallback)
 */
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

/**
 * Fetch candles with fallback from Binance to CryptoCompare
 */
async function fetchCandles(symbol, timeframe = '1d') {
  const interval = BINANCE_INTERVALS[timeframe] || '1d';

  // Try Binance first
  try {
    const candles = await fetchBinanceCandles(symbol, interval);
    if (candles && candles.length > 15) {
      return { candles, source: 'binance' };
    }
  } catch (e) {
    console.log(`Binance failed for ${symbol}: ${e.message}, trying CryptoCompare...`);
  }

  // Fallback to CryptoCompare
  try {
    const candles = await fetchCryptoCompareCandles(symbol, timeframe);
    if (candles && candles.length > 15) {
      return { candles, source: 'cryptocompare' };
    }
  } catch (e) {
    console.log(`CryptoCompare also failed for ${symbol}: ${e.message}`);
  }

  throw new Error(`No data available for ${symbol}`);
}

/**
 * Fetch current price from Binance
 */
async function fetchCurrentPrice(symbol) {
  const binanceSymbol = symbol.toUpperCase().includes('USDT')
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  try {
    const url = `${BINANCE_BASE}/api/v3/ticker/price?symbol=${binanceSymbol}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });
    const data = await res.json();
    if (data.price) return { price: parseFloat(data.price), source: 'binance' };
  } catch (e) {
    // Try crypto compare
  }

  try {
    const upperSymbol = symbol.toUpperCase().replace('USDT', '').replace('USD', '');
    const url = `${CRYPTOCOMPARE_BASE}/price?fsym=${upperSymbol}&tsyms=USDT`;
    const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });
    const data = await res.json();
    if (data.USDT) return { price: data.USDT, source: 'cryptocompare' };
  } catch (e) {}

  return { price: null, source: null };
}

module.exports = { fetchCandles, fetchCurrentPrice };
