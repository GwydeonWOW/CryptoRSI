/**
 * Backtest Engine + Routes
 *
 * Replays the auto-trader strategy over historical candle data.
 * Fetches candles from Binance with startTime/endTime, walks through
 * each candle, calculates RSI on-the-fly, and simulates buy/sell.
 */

const { Router } = require('express');
const { authMiddleware, adminMiddleware } = require('../auth');
const { fetchBinanceCandles } = require('../api');
const { calculateRSI } = require('../rsi');
const { loadSettings } = require('../settings');
const { loadTokens } = require('../config');
const logger = require('../logger');

const router = Router();

// Binance max candles per request
const BINANCE_PAGE = 1000;

/**
 * Fetch all candles in a date range, paginating if needed.
 */
async function fetchHistoricalCandles(symbol, interval, startMs, endMs) {
  const allCandles = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const candles = await fetchBinanceCandles(symbol, interval, BINANCE_PAGE, {
      startTime: cursor,
      endTime: endMs,
    });

    if (!candles || candles.length === 0) break;

    allCandles.push(...candles);

    // Move cursor past the last candle
    const lastTs = candles[candles.length - 1].timestamp;
    if (lastTs <= cursor) break; // safety: no infinite loop
    cursor = lastTs + 1;

    // If we got fewer than requested, we've reached the end
    if (candles.length < BINANCE_PAGE) break;
  }

  // Deduplicate by timestamp and sort
  const seen = new Set();
  const unique = [];
  for (const c of allCandles) {
    if (!seen.has(c.timestamp)) {
      seen.add(c.timestamp);
      unique.push(c);
    }
  }
  unique.sort((a, b) => a.timestamp - b.timestamp);
  return unique;
}

/**
 * Run backtest simulation over an array of candles.
 */
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

  // We need at least rsiPeriod + 1 candles to calculate RSI
  for (let i = rsiPeriod + 1; i < candles.length; i++) {
    const closesSoFar = candles.slice(0, i + 1).map(c => c.close);
    const rsiValues = calculateRSI(closesSoFar, rsiPeriod);
    const rsi = rsiValues[rsiValues.length - 1];
    if (rsi === null || rsi === undefined) continue;

    const candle = candles[i];
    const price = candle.close;
    const timestamp = candle.timestamp;
    const feeMultiplier = 1 - (feePercent / 100);

    // BUY signal
    if (rsi <= rsiOversold && !position) {
      const effectiveAmount = amount * feeMultiplier;
      const quantity = effectiveAmount / price;
      position = {
        entryPrice: price,
        amount,
        quantity,
        rsiAtOpen: rsi,
        openedAt: timestamp,
        openIndex: i,
      };
    }

    // SELL signal
    if (rsi >= rsiOverbought && position) {
      const exitValue = position.quantity * price * feeMultiplier;
      const pnl = exitValue - position.amount;
      const pnlPct = (pnl / position.amount) * 100;

      trades.push({
        entryPrice: position.entryPrice,
        exitPrice: price,
        amount: position.amount,
        quantity: position.quantity,
        exitValue,
        pnl,
        pnlPct,
        rsiAtOpen: position.rsiAtOpen,
        rsiAtClose: rsi,
        openedAt: position.openedAt,
        closedAt: timestamp,
        duration: timestamp - position.openedAt,
      });

      equity += pnl;
      position = null;
    }

    // Track equity curve at each candle
    const openPnl = position ? (position.quantity * price - position.amount) : 0;
    equityCurve.push({
      timestamp,
      equity: equity + openPnl,
      rsi,
      price,
    });
  }

  // Close any open position at the end
  if (position) {
    const lastPrice = candles[candles.length - 1].close;
    const lastTs = candles[candles.length - 1].timestamp;
    const feeMultiplier = 1 - (feePercent / 100);
    const exitValue = position.quantity * lastPrice * feeMultiplier;
    const pnl = exitValue - position.amount;
    const pnlPct = (pnl / position.amount) * 100;

    trades.push({
      entryPrice: position.entryPrice,
      exitPrice: lastPrice,
      amount: position.amount,
      quantity: position.quantity,
      exitValue,
      pnl,
      pnlPct,
      rsiAtOpen: position.rsiAtOpen,
      rsiAtClose: null,
      openedAt: position.openedAt,
      closedAt: lastTs,
      duration: lastTs - position.openedAt,
      forcedClose: true,
    });

    equity += pnl;
  }

  // Calculate stats
  const wins = trades.filter(t => t.pnl > 0).length;
  const losses = trades.filter(t => t.pnl <= 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const avgPnlPct = trades.length > 0 ? trades.reduce((sum, t) => sum + t.pnlPct, 0) / trades.length : 0;
  const bestTrade = trades.length > 0 ? trades.reduce((best, t) => t.pnl > best.pnl ? t : best) : null;
  const worstTrade = trades.length > 0 ? trades.reduce((worst, t) => t.pnl < worst.pnl ? t : worst) : null;

  // Max drawdown from equity curve
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
      losses,
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
    symbol,
    timeframe = '1h',
    fromDate,
    toDate,
    amount,
    feePercent,
    rsiOversold,
    rsiOverbought,
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

  // Merge with saved simulation config as defaults
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

    const intervalMap = { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };
    const interval = intervalMap[timeframe] || '1h';

    const candles = await fetchHistoricalCandles(symbol.toUpperCase(), interval, startMs, endMs);

    if (candles.length < 30) {
      return res.status(400).json({ error: `Not enough candles (${candles.length}). Need at least 30.` });
    }

    const result = simulateBacktest(candles, config);

    logger.info({ symbol, trades: result.stats.totalTrades, pnl: result.stats.totalPnl.toFixed(2) }, 'Backtest complete');

    res.json({
      ...result,
      config,
      symbol: symbol.toUpperCase(),
      timeframe,
      fromDate,
      toDate,
      candlesFetched: candles.length,
    });
  } catch (e) {
    logger.error({ err: e, symbol }, 'Backtest failed');
    res.status(500).json({ error: e.message });
  }
});

// Get available tokens for backtest dropdown
router.get('/backtest/tokens', authMiddleware, adminMiddleware, (req, res) => {
  const tokens = loadTokens();
  res.json(tokens);
});

// Get simulation config as defaults for backtest
router.get('/backtest/defaults', authMiddleware, adminMiddleware, (req, res) => {
  const settings = loadSettings();
  const sim = settings.simulation || {};
  res.json({
    amount: sim.amount ?? 1000,
    feePercent: sim.feePercent ?? 0,
    timeframes: sim.timeframes || {},
  });
});

module.exports = router;
