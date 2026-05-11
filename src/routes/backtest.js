/**
 * Backtest Engine + Routes
 *
 * Replays the auto-trader strategy over historical candle data.
 * Fetches candles from Binance with startTime/endTime, with CoinCap fallback.
 */

const { Router } = require('express');
const { authMiddleware, adminMiddleware } = require('../auth');
const fetch = require('node-fetch');
const { calculateRSI } = require('../rsi');
const { loadSettings } = require('../settings');
const { loadTokens } = require('../config');
const logger = require('../logger');

const router = Router();
const BINANCE_BASE = 'https://api.binance.com';
const BINANCE_PAGE = 1000;

// ============================================================
// Historical Candle Fetchers
// ============================================================

function deduplicate(candles) {
  const seen = new Set();
  const unique = [];
  for (const c of candles) {
    if (!seen.has(c.timestamp)) {
      seen.add(c.timestamp);
      unique.push(c);
    }
  }
  return unique.sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchHistoricalCandles(symbol, interval, startMs, endMs) {
  const binanceSymbol = symbol.toUpperCase().includes('USDT')
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  // Try Binance with pagination
  try {
    const allCandles = [];
    let cursor = startMs;

    while (cursor < endMs) {
      const url = `${BINANCE_BASE}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${BINANCE_PAGE}&startTime=${cursor}&endTime=${endMs}`;
      const response = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Binance ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) throw new Error(`Binance returned non-array: ${typeof data}`);
      if (data.length === 0) break;

      for (const k of data) {
        allCandles.push({
          timestamp: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
          low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
        });
      }

      const lastTs = data[data.length - 1][0];
      if (lastTs <= cursor) break;
      cursor = lastTs + 1;
      if (data.length < BINANCE_PAGE) break;
    }

    if (allCandles.length > 0) return deduplicate(allCandles);
  } catch (e) {
    logger.info({ symbol, err: e.message }, 'Binance historical failed, trying CoinCap');
  }

  // Fallback: CoinCap
  try {
    return await fetchCoinCapHistorical(symbol, interval, startMs, endMs);
  } catch (e) {
    throw new Error(`No historical data for ${symbol}: ${e.message}`);
  }
}

async function fetchCoinCapHistorical(symbol, interval, startMs, endMs) {
  const upper = symbol.toUpperCase().replace('USDT', '').replace('USD', '');
  const symbolToId = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
    'BNB': 'binance-coin', 'ADA': 'cardano', 'XRP': 'xrp',
    'DOGE': 'dogecoin', 'DOT': 'polkadot', 'TRX': 'tron',
    'AVAX': 'avalanche', 'LINK': 'chainlink', 'LTC': 'litecoin',
    'NEAR': 'near-protocol', 'APT': 'aptos', 'SUI': 'sui',
    'MATIC': 'polygon', 'SHIB': 'shiba-inu', 'PEPE': 'pepe',
  };
  const assetId = symbolToId[upper] || upper.toLowerCase();

  const intervalMap = { '15m': 'm15', '1h': 'h1', '4h': 'h6', '1d': 'd1' };
  const capInterval = intervalMap[interval] || 'h1';

  const allCandles = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const url = `https://api.coincap.io/v2/assets/${assetId}/history?interval=${capInterval}&start=${cursor}&end=${endMs}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });

    if (!response.ok) throw new Error(`CoinCap ${response.status}`);
    const result = await response.json();
    if (!result.data || result.data.length === 0) break;

    for (const d of result.data) {
      allCandles.push({
        timestamp: d.time,
        open: parseFloat(d.priceOpen) || parseFloat(d.price),
        high: parseFloat(d.priceHigh) || parseFloat(d.price),
        low: parseFloat(d.priceLow) || parseFloat(d.price),
        close: parseFloat(d.price),
        volume: parseFloat(d.volume) || 0,
      });
    }

    const lastTs = result.data[result.data.length - 1].time;
    if (lastTs <= cursor) break;
    cursor = lastTs + 1;
    if (result.data.length < 500) break;
  }

  if (allCandles.length === 0) throw new Error('CoinCap returned no data');
  return deduplicate(allCandles);
}

// ============================================================
// Simulation Engine
// ============================================================

function simulateBacktest(candles, config) {
  const {
    amount = 1000,
    feePercent = 0,
    rsiOversold = 30,
    rsiOverbought = 70,
    rsiPeriod = 14,
  } = config;

  const trades = [];
  let position = null;
  let equity = 0;
  const equityCurve = [];

  for (let i = rsiPeriod + 1; i < candles.length; i++) {
    const closesSoFar = candles.slice(0, i + 1).map(c => c.close);
    const rsiValues = calculateRSI(closesSoFar, rsiPeriod);
    const rsi = rsiValues[rsiValues.length - 1];
    if (rsi === null || rsi === undefined) continue;

    const candle = candles[i];
    const price = candle.close;
    const timestamp = candle.timestamp;
    const feeMultiplier = 1 - (feePercent / 100);

    if (rsi <= rsiOversold && !position) {
      const effectiveAmount = amount * feeMultiplier;
      const quantity = effectiveAmount / price;
      position = {
        entryPrice: price, amount, quantity,
        rsiAtOpen: rsi, openedAt: timestamp, openIndex: i,
      };
    }

    if (rsi >= rsiOverbought && position) {
      const exitValue = position.quantity * price * feeMultiplier;
      const pnl = exitValue - position.amount;
      const pnlPct = (pnl / position.amount) * 100;

      trades.push({
        entryPrice: position.entryPrice, exitPrice: price,
        amount: position.amount, quantity: position.quantity,
        exitValue, pnl, pnlPct,
        rsiAtOpen: position.rsiAtOpen, rsiAtClose: rsi,
        openedAt: position.openedAt, closedAt: timestamp,
        duration: timestamp - position.openedAt,
      });

      equity += pnl;
      position = null;
    }

    const openPnl = position ? (position.quantity * price - position.amount) : 0;
    equityCurve.push({ timestamp, equity: equity + openPnl, rsi, price });
  }

  if (position) {
    const lastPrice = candles[candles.length - 1].close;
    const lastTs = candles[candles.length - 1].timestamp;
    const feeMultiplier = 1 - (feePercent / 100);
    const exitValue = position.quantity * lastPrice * feeMultiplier;
    const pnl = exitValue - position.amount;
    const pnlPct = (pnl / position.amount) * 100;

    trades.push({
      entryPrice: position.entryPrice, exitPrice: lastPrice,
      amount: position.amount, quantity: position.quantity,
      exitValue, pnl, pnlPct,
      rsiAtOpen: position.rsiAtOpen, rsiAtClose: null,
      openedAt: position.openedAt, closedAt: lastTs,
      duration: lastTs - position.openedAt, forcedClose: true,
    });

    equity += pnl;
  }

  const wins = trades.filter(t => t.pnl > 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const avgPnlPct = trades.length > 0 ? trades.reduce((sum, t) => sum + t.pnlPct, 0) / trades.length : 0;
  const bestTrade = trades.length > 0 ? trades.reduce((best, t) => t.pnl > best.pnl ? t : best) : null;
  const worstTrade = trades.length > 0 ? trades.reduce((worst, t) => t.pnl < worst.pnl ? t : worst) : null;

  let maxDrawdown = 0;
  let peak = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak - point.equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    trades,
    stats: {
      totalTrades: trades.length,
      wins,
      losses: trades.length - wins,
      winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
      totalPnl,
      avgPnlPct,
      bestTrade: bestTrade ? { pnl: bestTrade.pnl, pnlPct: bestTrade.pnlPct } : null,
      worstTrade: worstTrade ? { pnl: worstTrade.pnl, pnlPct: worstTrade.pnlPct } : null,
      maxDrawdown,
      candlesAnalyzed: candles.length,
    },
    equityCurve: equityCurve.length > 500
      ? equityCurve.filter((_, i) => i % Math.ceil(equityCurve.length / 500) === 0)
      : equityCurve,
  };
}

// ============================================================
// Routes
// ============================================================

router.post('/backtest/run', authMiddleware, adminMiddleware, async (req, res) => {
  const {
    symbol, timeframe = '1h', fromDate, toDate,
    amount, feePercent, rsiOversold, rsiOverbought,
  } = req.body;

  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  if (!fromDate || !toDate) return res.status(400).json({ error: 'Date range is required' });

  const startMs = new Date(fromDate).getTime();
  const endMs = new Date(toDate).getTime();

  if (isNaN(startMs) || isNaN(endMs)) return res.status(400).json({ error: 'Invalid date format' });
  if (startMs >= endMs) return res.status(400).json({ error: 'Start date must be before end date' });
  if (endMs - startMs > 365 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'Maximum backtest range is 1 year' });
  }

  const settings = loadSettings();
  const sim = settings.simulation || {};
  const config = {
    amount: amount ?? sim.amount ?? 1000,
    feePercent: feePercent ?? sim.feePercent ?? 0,
    rsiOversold: rsiOversold ?? sim.timeframes?.[timeframe]?.rsiOversold ?? 30,
    rsiOverbought: rsiOverbought ?? sim.timeframes?.[timeframe]?.rsiOverbought ?? 70,
  };

  try {
    logger.info({ symbol, timeframe, fromDate, toDate, config }, 'Backtest started');

    const interval = timeframe;
    const candles = await fetchHistoricalCandles(symbol.toUpperCase(), interval, startMs, endMs);

    if (candles.length < 30) {
      return res.status(400).json({ error: `Not enough candles (${candles.length}). Need at least 30.` });
    }

    const result = simulateBacktest(candles, config);

    logger.info({ symbol, trades: result.stats.totalTrades, pnl: result.stats.totalPnl.toFixed(2) }, 'Backtest complete');

    res.json({
      ...result, config,
      symbol: symbol.toUpperCase(), timeframe, fromDate, toDate,
      candlesFetched: candles.length,
    });
  } catch (e) {
    logger.error({ err: e, symbol }, 'Backtest failed');
    res.status(500).json({ error: e.message });
  }
});

router.get('/backtest/tokens', authMiddleware, adminMiddleware, (req, res) => {
  res.json(loadTokens());
});

router.get('/backtest/defaults', authMiddleware, adminMiddleware, (req, res) => {
  const sim = loadSettings().simulation || {};
  res.json({
    amount: sim.amount ?? 1000,
    feePercent: sim.feePercent ?? 0,
    timeframes: sim.timeframes || {},
  });
});

module.exports = router;
