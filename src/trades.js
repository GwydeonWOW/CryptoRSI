/**
 * Trades Store - User-isolated JSON-based storage for simulated trades
 */

const fs = require('fs');
const path = require('path');
const { getDataDir, ensureDataDir, readJSON, writeJSON } = require('./storage');

const ADMIN_ID = 'admin_001';

/**
 * Get trades file path for a specific user.
 * Migrates legacy trades.json -> trades_admin_001.json on first access.
 */
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
 */
function openPosition(userId, symbol, price, rsiAtOpen, amount = 100) {
  const trades = loadTrades(userId);
  const upper = symbol.toUpperCase();

  const existing = trades.positions.find(p => p.symbol === upper);
  if (existing) {
    return { success: false, message: `Ya tienes una posicion abierta en ${upper}` };
  }

  const position = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    symbol: upper,
    entryPrice: price,
    rsiAtOpen,
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
 */
function closePosition(userId, symbol, currentPrice, rsiAtClose) {
  const trades = loadTrades(userId);
  const upper = symbol.toUpperCase();

  const idx = trades.positions.findIndex(p => p.symbol === upper);
  if (idx === -1) {
    return { success: false, message: `No hay posicion abierta en ${upper}` };
  }

  const position = trades.positions[idx];
  const exitValue = position.quantity * currentPrice;
  const pnl = exitValue - position.amount;
  const pnlPct = (pnl / position.amount) * 100;

  const closedTrade = {
    ...position,
    exitPrice: currentPrice,
    rsiAtClose,
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

function hasOpenPosition(userId, symbol) {
  const trades = loadTrades(userId);
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

module.exports = { openPosition, closePosition, getOpenPositions, hasOpenPosition, getHistory, getStats };
