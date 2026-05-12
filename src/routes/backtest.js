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
const { calculateSMA } = require('../api');
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
// SMA200 Support
// ============================================================

async function fetchSMACandles(symbol, startMs, endMs) {
  const results = {};
  // 1h needs 250 candles warm-up, 4h needs 250 candles warm-up
  const warmupMap = { '1h': 250 * 60 * 60 * 1000, '4h': 250 * 4 * 60 * 60 * 1000 };

  for (const interval of ['1h', '4h']) {
    try {
      const warmup = warmupMap[interval];
      const candles = await fetchHistoricalCandles(symbol, interval, startMs - warmup, endMs);
      if (candles.length >= 200) {
        results[interval] = candles;
      }
    } catch (e) {
      logger.info({ symbol, interval, err: e.message }, 'SMA candle fetch failed (optional)');
    }
  }
  return results;
}

function precomputeSMA200(smaCandles) {
  const sma200 = {};
  for (const [tf, candles] of Object.entries(smaCandles || {})) {
    const closes = candles.map(c => c.close);
    sma200[tf] = [];
    for (let i = 199; i < candles.length; i++) {
      const val = calculateSMA(closes.slice(0, i + 1), 200);
      if (val !== null) {
        sma200[tf].push({ timestamp: candles[i].timestamp, value: val });
      }
    }
  }
  return sma200;
}

function findNearestSMA(smaArray, targetTs) {
  if (!smaArray || smaArray.length === 0) return null;
  let lo = 0, hi = smaArray.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (smaArray[mid].timestamp < targetTs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(smaArray[lo - 1].timestamp - targetTs) < Math.abs(smaArray[lo].timestamp - targetTs)) {
    return smaArray[lo - 1].value;
  }
  return smaArray[lo].value;
}

// ============================================================
// Simulation Engine
// ============================================================

function simulateBacktest(candles, config, startMs, sma200Data) {
  const {
    amount = 1000,
    feePercent = 0,
    rsiOversold = 30,
    rsiOverbought = 70,
    rsiPeriod = 14,
    allowMultiple = false,
    maxInvestment = 0,
    minDelay = 0,
    maxBuys = 0,
    timeExitHours = 0,
    timeExitRSI = 50,
    seguroMult1h = 0.995,
    seguroMult4h = 0.9575,
  } = config;

  const allCloses = candles.map(c => c.close);
  const allRsi = calculateRSI(allCloses, rsiPeriod);

  const trades = [];
  let positions = [];
  let equity = 0;
  const equityCurve = [];
  const feeMultiplier = 1 - (feePercent / 100);
  let lastBuyTimestamp = 0;
  const timeExitMs = timeExitHours * 3600000;

  for (let i = rsiPeriod; i < candles.length; i++) {
    const rsi = allRsi[i - rsiPeriod];
    if (rsi === null || rsi === undefined) continue;

    const candle = candles[i];
    const price = candle.close;
    const timestamp = candle.timestamp;
    const inRange = timestamp >= startMs;

    // BUY signal (only within date range)
    const canBuy = allowMultiple || positions.length === 0;
    const withinDelay = !minDelay || timestamp - lastBuyTimestamp >= minDelay;
    const openInvested = positions.reduce((sum, p) => sum + p.amount, 0);
    const withinBudget = !maxInvestment || openInvested + amount <= maxInvestment;
    const withinMaxBuys = !maxBuys || positions.length < maxBuys;
    if (rsi <= rsiOversold && inRange && canBuy && withinDelay && withinBudget && withinMaxBuys) {
      const feeBuy = amount * (feePercent / 100);
      const effectiveAmount = amount * feeMultiplier;
      const quantity = effectiveAmount / price;
      const sma200_1h = findNearestSMA(sma200Data?.['1h'], timestamp);
      const sma200_4h = findNearestSMA(sma200Data?.['4h'], timestamp);
      const seguro = (sma200_1h != null && sma200_4h != null)
        ? (price <= sma200_1h * seguroMult1h && price >= sma200_4h * seguroMult4h)
        : false;
      positions.push({
        entryPrice: price, amount, quantity, feeBuy,
        rsiAtOpen: rsi, openedAt: timestamp, openIndex: i,
        sma200_1h, sma200_4h, seguro,
      });
      lastBuyTimestamp = timestamp;
    }

    // Time-based exit: close positions open > X hours when RSI >= exit threshold
    if (timeExitMs > 0 && positions.length > 0 && inRange) {
      const remaining = [];
      for (const pos of positions) {
        const duration = timestamp - pos.openedAt;
        if (duration >= timeExitMs && rsi >= timeExitRSI) {
          const grossExit = pos.quantity * price;
          const feeSell = grossExit * (feePercent / 100);
          const exitValue = grossExit * feeMultiplier;
          const pnl = exitValue - pos.amount;
          const pnlPct = (pnl / pos.amount) * 100;

          trades.push({
            entryPrice: pos.entryPrice, exitPrice: price,
            amount: pos.amount, quantity: pos.quantity,
            exitValue, pnl, pnlPct,
            feeBuy: pos.feeBuy, feeSell,
            totalFees: pos.feeBuy + feeSell,
            sma200_1h: pos.sma200_1h, sma200_4h: pos.sma200_4h,
            seguro: pos.seguro,
            rsiAtOpen: pos.rsiAtOpen, rsiAtClose: rsi,
            openedAt: pos.openedAt, closedAt: timestamp,
            duration: timestamp - pos.openedAt,
            timeExit: true,
          });

          equity += pnl;
        } else {
          remaining.push(pos);
        }
      }
      positions = remaining;
    }

    // SELL signal — close ALL remaining open positions
    if (rsi >= rsiOverbought && positions.length > 0 && inRange) {
      for (const pos of positions) {
        const grossExit = pos.quantity * price;
        const feeSell = grossExit * (feePercent / 100);
        const exitValue = grossExit * feeMultiplier;
        const pnl = exitValue - pos.amount;
        const pnlPct = (pnl / pos.amount) * 100;

        trades.push({
          entryPrice: pos.entryPrice, exitPrice: price,
          amount: pos.amount, quantity: pos.quantity,
          exitValue, pnl, pnlPct,
          feeBuy: pos.feeBuy, feeSell,
          totalFees: pos.feeBuy + feeSell,
          sma200_1h: pos.sma200_1h, sma200_4h: pos.sma200_4h,
          seguro: pos.seguro,
          rsiAtOpen: pos.rsiAtOpen, rsiAtClose: rsi,
          openedAt: pos.openedAt, closedAt: timestamp,
          duration: timestamp - pos.openedAt,
        });

        equity += pnl;
      }
      positions = [];
    }

    // Track equity curve only within date range
    if (inRange) {
      const openPnl = positions.reduce((sum, p) => sum + (p.quantity * price - p.amount), 0);
      equityCurve.push({ timestamp, equity: equity + openPnl, rsi, price });
    }
  }

  const wins = trades.filter(t => t.pnl > 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const totalFees = trades.reduce((sum, t) => sum + t.totalFees, 0);
  const totalPnlPct = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const avgPnlPct = trades.length > 0 ? totalPnlPct / trades.length : 0;
  const bestTrade = trades.length > 0 ? trades.reduce((best, t) => t.pnl > best.pnl ? t : best) : null;
  const worstTrade = trades.length > 0 ? trades.reduce((worst, t) => t.pnl < worst.pnl ? t : worst) : null;

  const candlesInRange = candles.filter(c => c.timestamp >= startMs).length;

  return {
    trades,
    stats: {
      totalTrades: trades.length,
      wins,
      losses: trades.length - wins,
      winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
      totalPnl,
      totalPnlPct,
      totalFees,
      avgPnlPct,
      bestTrade: bestTrade ? { pnl: bestTrade.pnl, pnlPct: bestTrade.pnlPct } : null,
      worstTrade: worstTrade ? { pnl: worstTrade.pnl, pnlPct: worstTrade.pnlPct } : null,
      candlesAnalyzed: candlesInRange,
      warmupCandles: candles.length - candlesInRange,
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
    startMs: clientStartMs, endMs: clientEndMs,
    allowMultiple, maxInvestment, minDelay,
    timeExitHours, timeExitRSI, maxBuys,
  } = req.body;

  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  if (!fromDate || !toDate) return res.status(400).json({ error: 'Date range is required' });

  // Prefer timestamps sent by the client (computed in user's local timezone).
  // Fall back to server-side UTC parsing for backwards compatibility.
  const startMs = clientStartMs != null ? clientStartMs : new Date(fromDate).getTime();
  const endMs = clientEndMs != null ? clientEndMs : new Date(toDate + 'T23:59:59').getTime();

  if (isNaN(startMs) || isNaN(endMs)) return res.status(400).json({ error: 'Invalid date format' });
  if (startMs >= endMs) return res.status(400).json({ error: 'Start date must be before end date' });
  if (endMs - startMs > 365 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'Maximum backtest range is 1 year' });
  }

  const settings = loadSettings();
  const sim = settings.simulation || {};
  const seguro = settings.seguro || {};
  const config = {
    amount: amount ?? sim.amount ?? 1000,
    feePercent: feePercent ?? sim.feePercent ?? 0,
    rsiOversold: rsiOversold ?? sim.timeframes?.[timeframe]?.rsiOversold ?? 30,
    rsiOverbought: rsiOverbought ?? sim.timeframes?.[timeframe]?.rsiOverbought ?? 70,
    allowMultiple: !!allowMultiple,
    maxInvestment: maxInvestment ? Number(maxInvestment) : 0,
    minDelay: minDelay ? Number(minDelay) : 0,
    maxBuys: maxBuys ? Number(maxBuys) : 0,
    timeExitHours: timeExitHours ? Number(timeExitHours) : 0,
    timeExitRSI: timeExitRSI ? Number(timeExitRSI) : 50,
    seguroMult1h: seguro.mult1h ?? 0.995,
    seguroMult4h: seguro.mult4h ?? 0.9575,
  };

  try {
    logger.info({ symbol, timeframe, fromDate, toDate, config }, 'Backtest started');

    const interval = timeframe;

    // Calculate warm-up period: fetch 500 candles before start date for RSI accuracy.
    // Wilder's smoothing converges after ~250 steps; 500 gives comfortable margin.
    const tfMsMap = { '15m': 15 * 60 * 1000, '1h': 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000 };
    const tfMs = tfMsMap[interval] || 60 * 60 * 1000;
    const warmupMs = 500 * tfMs;
    const warmupStart = startMs - warmupMs;

    // Fetch candles from warm-up start to end date
    const candles = await fetchHistoricalCandles(symbol.toUpperCase(), interval, warmupStart, endMs);

    if (candles.length < 30) {
      return res.status(400).json({ error: `Not enough candles (${candles.length}). Need at least 30.` });
    }

    // Fetch SMA200 candles (1h + 4h) independently — does not affect main pipeline
    const smaCandles = await fetchSMACandles(symbol.toUpperCase(), startMs, endMs);
    const sma200Data = precomputeSMA200(smaCandles);

    const result = simulateBacktest(candles, config, startMs, sma200Data);

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
