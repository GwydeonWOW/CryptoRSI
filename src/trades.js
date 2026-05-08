/**
 * Trades Store - User-isolated JSON-based storage for simulated trades
 * Supports multi-timeframe positions: each (symbol, timeframe) can have 1 open position.
 */

const fs = require('fs');
const path = require('path');
const { getDataDir, ensureDataDir, readJSON, writeJSON } = require('./storage');

const ADMIN_ID = 'admin_001';

function getTradesPath(userId) {
  ensureDataDir();
  const userPath = path.join(getDataDir(), `trades_${userId}.json`);

  // Migration: legacy trades.json -> trades_admin_001.json
  if (userId === ADMIN_ID && !fs.existsSync(userPath)) {
    const legacyPath = path.join(getDataDir(), 'trades.json');
    if (fs.existsSync(legacyPath)) {
      fs.renameSync(legacyPath, userPath);
      console.log('Migrated legacy trades.json -> trades_admin_001.json');
    }
  }

  return userPath;
}

function loadTrades(userId) {
  return readJSON(getTradesPath(userId), { positions: [], history: [] });
}

function saveTrades(userId, trades) {
  writeJSON(getTradesPath(userId), trades);
}

/**
 * Open a simulated position (buy)
 * @param {string} userId
 * @param {string} symbol
 * @param {number} price
 * @param {object} rsiData - { rsi15m, rsi1h, rsi4h, rsi1d, sma200, signalRSI }
 * @param {number} amount
 * @param {string} timeframe - '15m'|'1h'|'4h'|'1d' (default '1d' for backwards compat)
 */
function openPosition(userId, symbol, price, rsiData, amount = 100, timeframe = '1d') {
  const trades = loadTrades(userId);
  const upper = symbol.toUpperCase();

  // 1 position per (symbol, timeframe)
  const existing = trades.positions.find(p => p.symbol === upper && p.timeframe === timeframe);
  if (existing) {
    return { success: false, message: `Ya tienes una posicion abierta en ${upper} (${timeframe})` };
  }

  const signalRSI = typeof rsiData === 'number' ? rsiData : (rsiData?.signalRSI ?? rsiData);

  const rsi = typeof rsiData === 'object' && rsiData !== null
    ? { rsi15m: rsiData.rsi15m ?? null, rsi1h: rsiData.rsi1h ?? null, rsi4h: rsiData.rsi4h ?? null, rsi1d: rsiData.rsi1d ?? null, sma200: rsiData.sma200 ?? null, signalRSI }
    : { signalRSI };

  const position = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    symbol: upper,
    timeframe,
    entryPrice: price,
    rsiAtOpen: signalRSI,
    rsi,
    amount,
    quantity: amount / price,
    openedAt: new Date().toISOString(),
  };

  trades.positions.push(position);
  saveTrades(userId, trades);
  return { success: true, position };
}

/**
 * Close a simulated position (sell)
 * @param {string} userId
 * @param {string} symbol
 * @param {number} currentPrice
 * @param {object} rsiData - { rsi15m, rsi1h, rsi4h, rsi1d, sma200, signalRSI }
 * @param {string} timeframe - must match the open position's timeframe
 */
function closePosition(userId, symbol, currentPrice, rsiData, timeframe = '1d') {
  const trades = loadTrades(userId);
  const upper = symbol.toUpperCase();

  const idx = trades.positions.findIndex(p => p.symbol === upper && p.timeframe === timeframe);
  if (idx === -1) {
    // Fallback: try finding by symbol only (backwards compat)
    const legacyIdx = trades.positions.findIndex(p => p.symbol === upper && !p.timeframe);
    if (legacyIdx === -1) {
      return { success: false, message: `No hay posicion abierta en ${upper} (${timeframe})` };
    }
    return _closeAtIdx(trades, legacyIdx, userId, currentPrice, rsiData);
  }

  return _closeAtIdx(trades, idx, userId, currentPrice, rsiData);
}

function _closeAtIdx(trades, idx, userId, currentPrice, rsiData) {
  const position = trades.positions[idx];
  const exitValue = position.quantity * currentPrice;
  const pnl = exitValue - position.amount;
  const pnlPct = (pnl / position.amount) * 100;

  const signalRSI = typeof rsiData === 'number' ? rsiData : (rsiData?.signalRSI ?? rsiData);
  const rsiAtClose = typeof rsiData === 'object' && rsiData !== null
    ? { rsi15m: rsiData.rsi15m ?? null, rsi1h: rsiData.rsi1h ?? null, rsi4h: rsiData.rsi4h ?? null, rsi1d: rsiData.rsi1d ?? null, sma200: rsiData.sma200 ?? null, signalRSI }
    : { signalRSI };

  const closedTrade = {
    ...position,
    exitPrice: currentPrice,
    rsiAtClose: signalRSI,
    rsiClose: rsiAtClose,
    exitValue,
    pnl,
    pnlPct,
    closedAt: new Date().toISOString(),
  };

  trades.history.push(closedTrade);
  trades.positions.splice(idx, 1);
  saveTrades(userId, trades);

  return { success: true, trade: closedTrade };
}

function getOpenPositions(userId) {
  return loadTrades(userId).positions;
}

function getOpenPosition(userId, symbol, timeframe) {
  const trades = loadTrades(userId);
  return trades.positions.find(p => p.symbol === symbol.toUpperCase() && p.timeframe === timeframe) || null;
}

function hasOpenPosition(userId, symbol, timeframe) {
  const trades = loadTrades(userId);
  if (timeframe) {
    return trades.positions.some(p => p.symbol === symbol.toUpperCase() && p.timeframe === timeframe);
  }
  // Backwards compat: no timeframe = check any position for symbol
  return trades.positions.some(p => p.symbol === symbol.toUpperCase());
}

function getHistory(userId) {
  return loadTrades(userId).history;
}

function getStats(userId) {
  const history = loadTrades(userId).history;

  if (history.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      totalPnl: 0, avgPnlPct: 0, bestTrade: null, worstTrade: null,
    };
  }

  const wins = history.filter(t => t.pnl > 0);
  const losses = history.filter(t => t.pnl <= 0);
  const totalPnl = history.reduce((s, t) => s + t.pnl, 0);
  const avgPnlPct = history.reduce((s, t) => s + t.pnlPct, 0) / history.length;
  const sorted = [...history].sort((a, b) => b.pnl - a.pnl);

  return {
    totalTrades: history.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / history.length) * 100,
    totalPnl,
    avgPnlPct,
    bestTrade: sorted[0],
    worstTrade: sorted[sorted.length - 1],
  };
}

module.exports = { openPosition, closePosition, getOpenPositions, getOpenPosition, hasOpenPosition, getHistory, getStats };
