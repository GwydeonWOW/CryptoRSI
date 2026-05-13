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
const { shouldSkip, evaluateConditions } = require('../entryFilter');
const { loadSettings } = require('../settings');
const { loadTokens } = require('../config');
const { getDb } = require('../db');
const logger = require('../logger');

const router = Router();
const BINANCE_BASE = 'https://api.binance.com';
const BINANCE_PAGE = 1000;
const TF_MS_MAP = { '15m': 15 * 60 * 1000, '1h': 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000 };

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
// Multi-Timeframe Candle & RSI Data
// ============================================================

async function fetchSMACandles(symbol, startMs, endMs) {
  const results = {};
  const warmupMap = { '1h': 250 * 60 * 60 * 1000, '4h': 250 * 4 * 60 * 60 * 1000 };

  for (const interval of ['1h', '4h']) {
    try {
      const warmup = warmupMap[interval];
      const candles = await fetchHistoricalCandles(symbol, interval, startMs - warmup, endMs);
      if (candles.length >= 200) results[interval] = candles;
    } catch (e) {
      logger.info({ symbol, interval, err: e.message }, 'SMA candle fetch failed (optional)');
    }
  }
  return results;
}

async function fetchReferenceCandles(symbol, signalTF, startMs, endMs) {
  const signalTfMs = TF_MS_MAP[signalTF] || TF_MS_MAP['1h'];
  const warmupStart = startMs - 500 * signalTfMs;
  const referenceTfs = ['1h', '4h', '1d'].filter(tf => tf !== signalTF);
  const refWarmup = 50; // fewer candles needed for reference RSI

  const reference = {};
  for (const tf of referenceTfs) {
    try {
      const tfMs = TF_MS_MAP[tf];
      const candles = await fetchHistoricalCandles(symbol, tf, startMs - refWarmup * tfMs, endMs);
      if (candles.length > 0) reference[tf] = candles;
    } catch (e) {
      logger.info({ symbol, tf, err: e.message }, 'Reference candle fetch failed (optional)');
    }
  }
  // Also include signal TF in reference if it's one of 1h/4h/1d
  if (['1h', '4h', '1d'].includes(signalTF)) {
    // Will be computed from main candles
  }
  return reference;
}

function precomputeSMA200(smaCandles) {
  const sma200 = {};
  for (const [tf, candles] of Object.entries(smaCandles || {})) {
    const closes = candles.map(c => c.close);
    sma200[tf] = [];
    for (let i = 199; i < candles.length; i++) {
      const val = calculateSMA(closes.slice(0, i + 1), 200);
      if (val !== null) sma200[tf].push({ timestamp: candles[i].timestamp, value: val });
    }
  }
  return sma200;
}

function precomputeReferenceRSI(referenceCandles, signalCandles, signalTF, rsiPeriod) {
  const result = {};
  for (const [tf, candles] of Object.entries(referenceCandles || {})) {
    const closes = candles.map(c => c.close);
    const rsiValues = calculateRSI(closes, rsiPeriod);
    result[tf] = [];
    for (let i = rsiPeriod; i < candles.length; i++) {
      const rsi = rsiValues[i - rsiPeriod];
      if (rsi != null) result[tf].push({ timestamp: candles[i].timestamp, rsi });
    }
  }
  // Include signal TF in reference data (computed from main candles)
  if (['1h', '4h', '1d'].includes(signalTF) && signalCandles) {
    const closes = signalCandles.map(c => c.close);
    const rsiValues = calculateRSI(closes, rsiPeriod);
    result[signalTF] = [];
    for (let i = rsiPeriod; i < signalCandles.length; i++) {
      const rsi = rsiValues[i - rsiPeriod];
      if (rsi != null) result[signalTF].push({ timestamp: signalCandles[i].timestamp, rsi });
    }
  }
  return result;
}

// ============================================================
// Shared Helpers
// ============================================================

function findNearest(arr, targetTs) {
  if (!arr || arr.length === 0) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].timestamp < targetTs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(arr[lo - 1].timestamp - targetTs) < Math.abs(arr[lo].timestamp - targetTs)) return arr[lo - 1];
  return arr[lo];
}

function findNearestValue(arr, targetTs) {
  const point = findNearest(arr, targetTs);
  return point?.value ?? point?.rsi ?? null;
}

function closeTrade(pos, price, rsi, timestamp, feePercent, feeMultiplier, extra = {}) {
  const grossExit = pos.quantity * price;
  const feeSell = grossExit * (feePercent / 100);
  const exitValue = grossExit * feeMultiplier;
  const pnl = exitValue - pos.amount;
  const pnlPct = (pnl / pos.amount) * 100;
  return {
    symbol: pos.symbol,
    entryPrice: pos.entryPrice, exitPrice: price,
    amount: pos.amount, quantity: pos.quantity,
    exitValue, pnl, pnlPct,
    feeBuy: pos.feeBuy, feeSell, totalFees: pos.feeBuy + feeSell,
    sma200_1h: pos.sma200_1h, sma200_4h: pos.sma200_4h,
    seguro: pos.seguro,
    rsiAtOpen: pos.rsiAtOpen, rsiAtClose: rsi,
    rsi1hAtOpen: pos.rsi1hAtOpen, rsi4hAtOpen: pos.rsi4hAtOpen, rsi1dAtOpen: pos.rsi1dAtOpen,
    openedAt: pos.openedAt, closedAt: timestamp,
    duration: timestamp - pos.openedAt,
    activeRule: pos.activeRule,
    ...extra,
  };
}

function computeStats(trades, candlesInRange, warmupCandles) {
  const wins = trades.filter(t => t.pnl > 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const totalFees = trades.reduce((sum, t) => sum + t.totalFees, 0);
  const totalPnlPct = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const avgPnlPct = trades.length > 0 ? totalPnlPct / trades.length : 0;
  const bestTrade = trades.length > 0 ? trades.reduce((b, t) => t.pnl > b.pnl ? t : b) : null;
  const worstTrade = trades.length > 0 ? trades.reduce((w, t) => t.pnl < w.pnl ? t : w) : null;

  return {
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
    warmupCandles,
  };
}

function downsampleCurve(curve) {
  if (curve.length <= 500) return curve;
  const step = Math.ceil(curve.length / 500);
  return curve.filter((_, i) => i % step === 0);
}

// ============================================================
// Conditional RSI Rules + Compound Interest
// ============================================================

function resolveRsiThresholds(rsiRulesConfig, refRSI, defaultOversold, defaultOverbought) {
  if (!rsiRulesConfig?.enabled) return { oversold: defaultOversold, overbought: defaultOverbought, ruleIndex: -1 };

  for (let ri = 0; ri < (rsiRulesConfig.rules || []).length; ri++) {
    const rule = rsiRulesConfig.rules[ri];
    if (rule.enabled === false) continue;
    const allMatch = (rule.conditions || []).every(cond => {
      const rsi = refRSI[cond.timeframe];
      if (rsi == null) return false;
      switch (cond.op) {
        case '>': return rsi > cond.value;
        case '<': return rsi < cond.value;
        case '>=': return rsi >= cond.value;
        case '<=': return rsi <= cond.value;
        case 'between': return rsi >= cond.value && rsi <= (cond.value2 ?? cond.value);
        default: return false;
      }
    });
    if (allMatch) return { oversold: rule.oversold, overbought: rule.overbought, ruleIndex: ri };
  }
  return { oversold: defaultOversold, overbought: defaultOverbought, ruleIndex: -1 };
}

function calcTradeAmount(compoundConfig, baseAmount, realizedProfit) {
  if (!compoundConfig?.enabled) return baseAmount;
  const base = baseAmount;
  switch (compoundConfig.mode) {
    case 'level':
      return base * (1 + Math.floor(Math.max(0, realizedProfit) / base));
    case 'reinvest':
      return Math.max(base, base + realizedProfit);
    case 'step':
      const step = compoundConfig.step || base;
      return base + step * Math.floor(Math.max(0, realizedProfit) / step);
    default:
      return base;
  }
}

function getReferenceRSI(referenceRSIData, timestamp) {
  const refRSI = {};
  for (const tf of ['1h', '4h', '1d']) {
    const arr = referenceRSIData[tf];
    refRSI[tf] = arr ? findNearestValue(arr, timestamp) : null;
  }
  return refRSI;
}

// ============================================================
// Simulation Engine — Single Token
// ============================================================

function simulateBacktest(candles, config, startMs, sma200Data, referenceRSI) {
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
    seguro = {},
    rsiRules,
    compound,
  } = config;

  const allCloses = candles.map(c => c.close);
  const allRsi = calculateRSI(allCloses, rsiPeriod);
  const feeMultiplier = 1 - (feePercent / 100);
  const timeExitMs = timeExitHours * 3600000;

  const trades = [];
  let positions = [];
  let equity = 0;
  let realizedProfit = 0;
  const equityCurve = [];
  let lastBuyTimestamp = 0;

  for (let i = rsiPeriod; i < candles.length; i++) {
    const rsi = allRsi[i - rsiPeriod];
    if (rsi === null || rsi === undefined) continue;

    const candle = candles[i];
    const price = candle.close;
    const timestamp = candle.timestamp;
    const inRange = timestamp >= startMs;
    if (!inRange) continue;

    // Reference RSI for this timestamp
    const refRSI = getReferenceRSI(referenceRSI || {}, timestamp);

    // Resolve dynamic thresholds from conditional rules
    const { oversold, overbought, ruleIndex } = resolveRsiThresholds(rsiRules, refRSI, rsiOversold, rsiOverbought);

    // SMA + seguro
    const sma200_1h = findNearestValue(sma200Data?.['1h'], timestamp);
    const sma200_4h = findNearestValue(sma200Data?.['4h'], timestamp);
    const filterData = { price, sma200_1h, sma200_4h, rsi };
    const seguroLabel = evaluateConditions(seguro.conditions, seguro.logic, filterData);
    const passesSeguroFilter = seguro.filterEntries
      ? !shouldSkip({ enabled: true, action: seguro.filterAction || 'skip', logic: seguro.logic, conditions: seguro.conditions }, filterData)
      : true;

    // BUY signal
    const tradeAmt = calcTradeAmount(compound, amount, realizedProfit);
    const canBuy = allowMultiple || positions.length === 0;
    const withinDelay = !minDelay || timestamp - lastBuyTimestamp >= minDelay;
    const openInvested = positions.reduce((sum, p) => sum + p.amount, 0);
    const withinBudget = !maxInvestment || openInvested + tradeAmt <= maxInvestment;
    const withinMaxBuys = !maxBuys || positions.length < maxBuys;

    if (rsi <= oversold && canBuy && withinDelay && withinBudget && withinMaxBuys && passesSeguroFilter) {
      const feeBuy = tradeAmt * (feePercent / 100);
      const effectiveAmount = tradeAmt * feeMultiplier;
      const quantity = effectiveAmount / price;
      positions.push({
        entryPrice: price, amount: tradeAmt, quantity, feeBuy,
        rsiAtOpen: rsi, openedAt: timestamp, openIndex: i,
        sma200_1h, sma200_4h, seguro: seguroLabel, activeRule: ruleIndex,
        rsi1hAtOpen: refRSI['1h'], rsi4hAtOpen: refRSI['4h'], rsi1dAtOpen: refRSI['1d'],
      });
      lastBuyTimestamp = timestamp;
    }

    // Time-based exit
    if (timeExitMs > 0 && positions.length > 0) {
      const remaining = [];
      for (const pos of positions) {
        const duration = timestamp - pos.openedAt;
        if (duration >= timeExitMs && rsi >= timeExitRSI) {
          const trade = closeTrade(pos, price, rsi, timestamp, feePercent, feeMultiplier, { timeExit: true });
          trade.rsi1hAtClose = refRSI['1h'];
          trade.rsi4hAtClose = refRSI['4h'];
          trade.rsi1dAtClose = refRSI['1d'];
          trades.push(trade);
          equity += trade.pnl;
          realizedProfit += trade.pnl;
        } else {
          remaining.push(pos);
        }
      }
      positions = remaining;
    }

    // SELL signal — close ALL open positions
    if (rsi >= overbought && positions.length > 0) {
      for (const pos of positions) {
        const trade = closeTrade(pos, price, rsi, timestamp, feePercent, feeMultiplier);
        trade.rsi1hAtClose = refRSI['1h'];
        trade.rsi4hAtClose = refRSI['4h'];
        trade.rsi1dAtClose = refRSI['1d'];
        trades.push(trade);
        equity += trade.pnl;
        realizedProfit += trade.pnl;
      }
      positions = [];
    }

    // Equity curve
    const openPnl = positions.reduce((sum, p) => sum + (p.quantity * price - p.amount), 0);
    equityCurve.push({ timestamp, equity: equity + openPnl, rsi, price });
  }

  const candlesInRange = candles.filter(c => c.timestamp >= startMs).length;

  return {
    trades,
    stats: computeStats(trades, candlesInRange, candles.length - candlesInRange),
    equityCurve: downsampleCurve(equityCurve),
  };
}

// ============================================================
// Simulation Engine — Multi-Token
// ============================================================

const sleep = ms => new Promise(r => setTimeout(r, ms));

function simulateMultiBacktest(candlesBySymbol, sma200BySymbol, referenceRSIBySymbol, config, startMs) {
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
    seguro = {},
    rsiRules,
    compound,
  } = config;

  const feeMultiplier = 1 - (feePercent / 100);
  const timeExitMs = timeExitHours * 3600000;
  const symbols = Object.keys(candlesBySymbol);

  // Build merged event stream
  const events = [];
  for (const symbol of symbols) {
    const candles = candlesBySymbol[symbol];
    const closes = candles.map(c => c.close);
    const rsiValues = calculateRSI(closes, rsiPeriod);
    for (let i = rsiPeriod; i < candles.length; i++) {
      const rsi = rsiValues[i - rsiPeriod];
      if (rsi == null) continue;
      if (candles[i].timestamp < startMs) continue;
      events.push({ timestamp: candles[i].timestamp, symbol, price: candles[i].close, rsi });
    }
  }

  events.sort((a, b) => a.timestamp - b.timestamp || a.symbol.localeCompare(b.symbol));

  const positionsBySymbol = {};
  const lastBuyBySymbol = {};
  for (const s of symbols) { positionsBySymbol[s] = []; lastBuyBySymbol[s] = 0; }

  const trades = [];
  let equity = 0;
  let realizedProfit = 0;
  const equityCurve = [];
  const lastPriceBySymbol = {};

  for (const event of events) {
    const { timestamp, symbol, price, rsi } = event;
    lastPriceBySymbol[symbol] = price;
    const positions = positionsBySymbol[symbol];

    const refRSI = getReferenceRSI(referenceRSIBySymbol?.[symbol] || {}, timestamp);
    const { oversold, overbought, ruleIndex } = resolveRsiThresholds(rsiRules, refRSI, rsiOversold, rsiOverbought);

    const sma200_1h = findNearestValue(sma200BySymbol?.[symbol]?.['1h'], timestamp);
    const sma200_4h = findNearestValue(sma200BySymbol?.[symbol]?.['4h'], timestamp);
    const filterData = { price, sma200_1h, sma200_4h, rsi };
    const seguroLabel = evaluateConditions(seguro.conditions, seguro.logic, filterData);
    const passesSeguroFilter = seguro.filterEntries
      ? !shouldSkip({ enabled: true, action: seguro.filterAction || 'skip', logic: seguro.logic, conditions: seguro.conditions }, filterData)
      : true;

    // BUY
    const tradeAmt = calcTradeAmount(compound, amount, realizedProfit);
    const canBuy = allowMultiple || positions.length === 0;
    const withinDelay = !minDelay || timestamp - lastBuyBySymbol[symbol] >= minDelay;
    const totalOpenInvested = Object.values(positionsBySymbol).flat().reduce((sum, p) => sum + p.amount, 0);
    const withinBudget = !maxInvestment || totalOpenInvested + tradeAmt <= maxInvestment;
    const withinMaxBuys = !maxBuys || positions.length < maxBuys;

    if (rsi <= oversold && canBuy && withinDelay && withinBudget && withinMaxBuys && passesSeguroFilter) {
      const feeBuy = tradeAmt * (feePercent / 100);
      const effectiveAmount = tradeAmt * feeMultiplier;
      const quantity = effectiveAmount / price;
      positions.push({
        entryPrice: price, amount: tradeAmt, quantity, feeBuy,
        rsiAtOpen: rsi, openedAt: timestamp,
        sma200_1h, sma200_4h, seguro: seguroLabel, symbol, activeRule: ruleIndex,
        rsi1hAtOpen: refRSI['1h'], rsi4hAtOpen: refRSI['4h'], rsi1dAtOpen: refRSI['1d'],
      });
      lastBuyBySymbol[symbol] = timestamp;
    }

    // Time exit
    if (timeExitMs > 0 && positions.length > 0) {
      const remaining = [];
      for (const pos of positions) {
        const duration = timestamp - pos.openedAt;
        if (duration >= timeExitMs && rsi >= timeExitRSI) {
          const trade = closeTrade(pos, price, rsi, timestamp, feePercent, feeMultiplier, { timeExit: true });
          trade.rsi1hAtClose = refRSI['1h'];
          trade.rsi4hAtClose = refRSI['4h'];
          trade.rsi1dAtClose = refRSI['1d'];
          trades.push(trade);
          equity += trade.pnl;
          realizedProfit += trade.pnl;
        } else {
          remaining.push(pos);
        }
      }
      positionsBySymbol[symbol] = remaining;
    }

    // SELL
    const currentPositions = positionsBySymbol[symbol];
    if (rsi >= overbought && currentPositions.length > 0) {
      for (const pos of currentPositions) {
        const trade = closeTrade(pos, price, rsi, timestamp, feePercent, feeMultiplier);
        trade.rsi1hAtClose = refRSI['1h'];
        trade.rsi4hAtClose = refRSI['4h'];
        trade.rsi1dAtClose = refRSI['1d'];
        trades.push(trade);
        equity += trade.pnl;
        realizedProfit += trade.pnl;
      }
      positionsBySymbol[symbol] = [];
    }

    // Equity curve
    const totalOpenPnl = Object.entries(positionsBySymbol).reduce((sum, [sym, posArr]) => {
      const symPrice = lastPriceBySymbol[sym] || 0;
      return sum + posArr.reduce((s, p) => s + (p.quantity * symPrice - p.amount), 0);
    }, 0);
    equityCurve.push({ timestamp, equity: equity + totalOpenPnl });
  }

  // Per-symbol stats
  const bySymbol = {};
  for (const symbol of symbols) {
    const symTrades = trades.filter(t => t.symbol === symbol);
    const wins = symTrades.filter(t => t.pnl > 0).length;
    const totalPnl = symTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalPnlPct = symTrades.reduce((sum, t) => sum + t.pnlPct, 0);
    const totalFees = symTrades.reduce((sum, t) => sum + t.totalFees, 0);
    bySymbol[symbol] = {
      trades: symTrades,
      stats: {
        totalTrades: symTrades.length, wins, losses: symTrades.length - wins,
        winRate: symTrades.length > 0 ? (wins / symTrades.length) * 100 : 0,
        totalPnl, totalPnlPct, totalFees,
        avgPnlPct: symTrades.length > 0 ? totalPnlPct / symTrades.length : 0,
      },
    };
  }

  // Combined stats
  const combined = computeStats(trades, 0, 0);
  delete combined.candlesAnalyzed;
  delete combined.warmupCandles;
  const bestTrade = trades.length > 0 ? trades.reduce((b, t) => t.pnl > b.pnl ? t : b) : null;
  const worstTrade = trades.length > 0 ? trades.reduce((w, t) => t.pnl < w.pnl ? t : w) : null;
  if (bestTrade) combined.bestTrade = { pnl: bestTrade.pnl, pnlPct: bestTrade.pnlPct, symbol: bestTrade.symbol };
  if (worstTrade) combined.worstTrade = { pnl: worstTrade.pnl, pnlPct: worstTrade.pnlPct, symbol: worstTrade.symbol };

  return { trades, bySymbol, combined, equityCurve: downsampleCurve(equityCurve) };
}

// ============================================================
// Routes
// ============================================================

function buildConfig(reqBody, settings) {
  const sim = settings.simulation || {};
  const timeframe = reqBody.timeframe || '1h';
  return {
    amount: reqBody.amount ?? sim.amount ?? 1000,
    feePercent: reqBody.feePercent ?? sim.feePercent ?? 0,
    rsiOversold: reqBody.rsiOversold ?? sim.timeframes?.[timeframe]?.rsiOversold ?? 30,
    rsiOverbought: reqBody.rsiOverbought ?? sim.timeframes?.[timeframe]?.rsiOverbought ?? 70,
    allowMultiple: !!reqBody.allowMultiple,
    maxInvestment: reqBody.maxInvestment ? Number(reqBody.maxInvestment) : 0,
    minDelay: reqBody.minDelay ? Number(reqBody.minDelay) : 0,
    maxBuys: reqBody.maxBuys ? Number(reqBody.maxBuys) : 0,
    timeExitHours: reqBody.timeExitHours ? Number(reqBody.timeExitHours) : 0,
    timeExitRSI: reqBody.timeExitRSI ? Number(reqBody.timeExitRSI) : 50,
    seguro: settings.seguro || {},
    rsiRules: reqBody.rsiRules || null,
    compound: reqBody.compound || null,
  };
}

router.post('/backtest/run', authMiddleware, adminMiddleware, async (req, res) => {
  const { symbol, timeframe = '1h', fromDate, toDate, startMs: clientStartMs, endMs: clientEndMs } = req.body;

  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  if (!fromDate || !toDate) return res.status(400).json({ error: 'Date range is required' });

  const startMs = clientStartMs != null ? clientStartMs : new Date(fromDate).getTime();
  const endMs = clientEndMs != null ? clientEndMs : new Date(toDate + 'T23:59:59').getTime();

  if (isNaN(startMs) || isNaN(endMs)) return res.status(400).json({ error: 'Invalid date format' });
  if (startMs >= endMs) return res.status(400).json({ error: 'Start date must be before end date' });
  if (endMs - startMs > 365 * 24 * 60 * 60 * 1000) return res.status(400).json({ error: 'Maximum backtest range is 1 year' });

  const settings = loadSettings();
  const config = buildConfig({ ...req.body, timeframe }, settings);

  try {
    logger.info({ symbol, timeframe, fromDate, toDate }, 'Backtest started');

    const tfMs = TF_MS_MAP[timeframe] || TF_MS_MAP['1h'];
    const warmupStart = startMs - 500 * tfMs;

    const candles = await fetchHistoricalCandles(symbol.toUpperCase(), timeframe, warmupStart, endMs);
    if (candles.length < 30) return res.status(400).json({ error: `Not enough candles (${candles.length}). Need at least 30.` });

    const smaCandles = await fetchSMACandles(symbol.toUpperCase(), startMs, endMs);
    const sma200Data = precomputeSMA200(smaCandles);

    const referenceCandles = await fetchReferenceCandles(symbol.toUpperCase(), timeframe, startMs, endMs);
    const referenceRSI = precomputeReferenceRSI(referenceCandles, candles, timeframe, config.rsiPeriod ?? 14);

    const result = simulateBacktest(candles, config, startMs, sma200Data, referenceRSI);

    logger.info({ symbol, trades: result.stats.totalTrades, pnl: result.stats.totalPnl.toFixed(2) }, 'Backtest complete');
    res.json({ ...result, config, symbol: symbol.toUpperCase(), timeframe, fromDate, toDate, candlesFetched: candles.length });
  } catch (e) {
    logger.error({ err: e, symbol }, 'Backtest failed');
    res.status(500).json({ error: e.message });
  }
});

router.post('/backtest/run-multi', authMiddleware, adminMiddleware, async (req, res) => {
  const { symbols, timeframe = '1h', fromDate, toDate, startMs: clientStartMs, endMs: clientEndMs } = req.body;

  if (!symbols || !Array.isArray(symbols) || symbols.length === 0) return res.status(400).json({ error: 'symbols array is required' });
  if (symbols.length > 20) return res.status(400).json({ error: 'Maximum 20 tokens per multi-backtest' });
  if (!fromDate || !toDate) return res.status(400).json({ error: 'Date range is required' });

  const startMs = clientStartMs != null ? clientStartMs : new Date(fromDate).getTime();
  const endMs = clientEndMs != null ? clientEndMs : new Date(toDate + 'T23:59:59').getTime();

  if (isNaN(startMs) || isNaN(endMs)) return res.status(400).json({ error: 'Invalid date format' });
  if (startMs >= endMs) return res.status(400).json({ error: 'Start date must be before end date' });
  if (endMs - startMs > 365 * 24 * 60 * 60 * 1000) return res.status(400).json({ error: 'Maximum backtest range is 1 year' });

  const settings = loadSettings();
  const config = buildConfig({ ...req.body, timeframe }, settings);

  try {
    logger.info({ symbols, timeframe, fromDate, toDate }, 'Multi-backtest started');

    const tfMs = TF_MS_MAP[timeframe] || TF_MS_MAP['1h'];
    const warmupStart = startMs - 500 * tfMs;

    const candlesBySymbol = {};
    const sma200BySymbol = {};
    const referenceRSIBySymbol = {};
    const errors = [];

    for (const symbol of symbols) {
      const sym = symbol.toUpperCase();
      try {
        const candles = await fetchHistoricalCandles(sym, timeframe, warmupStart, endMs);
        if (candles.length < 30) { errors.push({ symbol: sym, error: `Not enough candles (${candles.length})` }); continue; }
        candlesBySymbol[sym] = candles;

        const smaCandles = await fetchSMACandles(sym, startMs, endMs);
        sma200BySymbol[sym] = precomputeSMA200(smaCandles);

        const referenceCandles = await fetchReferenceCandles(sym, timeframe, startMs, endMs);
        referenceRSIBySymbol[sym] = precomputeReferenceRSI(referenceCandles, candles, timeframe, config.rsiPeriod ?? 14);

        await sleep(150);
      } catch (e) {
        errors.push({ symbol: sym, error: e.message });
        logger.info({ symbol: sym, err: e.message }, 'Multi-backtest: symbol failed');
      }
    }

    if (Object.keys(candlesBySymbol).length === 0) return res.status(400).json({ error: 'No data fetched for any token', errors });

    const result = simulateMultiBacktest(candlesBySymbol, sma200BySymbol, referenceRSIBySymbol, config, startMs);

    logger.info({ symbols: Object.keys(candlesBySymbol), trades: result.combined.totalTrades, pnl: result.combined.totalPnl.toFixed(2), errors: errors.length }, 'Multi-backtest complete');
    res.json({ ...result, config, timeframe, fromDate, toDate, errors: errors.length > 0 ? errors : undefined });
  } catch (e) {
    logger.error({ err: e }, 'Multi-backtest failed');
    res.status(500).json({ error: e.message });
  }
});

router.get('/backtest/tokens', authMiddleware, adminMiddleware, (req, res) => {
  res.json(loadTokens());
});

router.get('/backtest/defaults', authMiddleware, adminMiddleware, (req, res) => {
  const sim = loadSettings().simulation || {};
  res.json({ amount: sim.amount ?? 1000, feePercent: sim.feePercent ?? 0, timeframes: sim.timeframes || {} });
});

// ============================================================
// Save / Load Simulation Results
// ============================================================

function extractSummary(result) {
  const isMulti = !!result.bySymbol;
  const stats = isMulti ? result.combined : result.stats;
  return JSON.stringify({
    isMulti,
    totalTrades: stats?.totalTrades || 0,
    winRate: stats?.winRate || 0,
    totalPnl: stats?.totalPnl || 0,
    symbols: isMulti ? Object.keys(result.bySymbol || {}) : [result.symbol],
    timeframe: result.timeframe,
    fromDate: result.fromDate,
    toDate: result.toDate,
  });
}

router.post('/backtest/save', authMiddleware, adminMiddleware, (req, res) => {
  const { label, config, result } = req.body;
  if (!result) return res.status(400).json({ error: 'Result is required' });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    const db = getDb();
    db.prepare('INSERT INTO backtest_results (id, created_at, label, config, result, summary) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, new Date().toISOString(), (label || '').slice(0, 200) || 'Sin nombre', JSON.stringify(config || {}), JSON.stringify(result), extractSummary(result));
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/backtest/saved', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT id, created_at, label, config, summary FROM backtest_results ORDER BY created_at DESC').all();
    res.json(rows.map(r => ({
      id: r.id, createdAt: r.created_at, label: r.label,
      config: r.config ? JSON.parse(r.config) : {},
      summary: r.summary ? JSON.parse(r.summary) : null,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/backtest/saved/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM backtest_results WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({
      id: row.id, createdAt: row.created_at, label: row.label,
      config: row.config ? JSON.parse(row.config) : {},
      result: row.result ? JSON.parse(row.result) : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/backtest/saved/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const changes = db.prepare('DELETE FROM backtest_results WHERE id = ?').run(req.params.id).changes;
    res.json({ success: true, deleted: changes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
