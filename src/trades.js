/**
 * Trades Store - Simple JSON-based storage for simulated trades
 */

const fs = require('fs');
const path = require('path');

const TRADES_PATH = path.join(__dirname, '..', 'data', 'trades.json');

function ensureDataDir() {
  const dir = path.dirname(TRADES_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadTrades() {
  ensureDataDir();
  try {
    if (fs.existsSync(TRADES_PATH)) {
      return JSON.parse(fs.readFileSync(TRADES_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading trades:', e.message);
  }
  return { positions: [], history: [] };
}

function saveTrades(trades) {
  ensureDataDir();
  fs.writeFileSync(TRADES_PATH, JSON.stringify(trades, null, 2));
}

/**
 * Open a simulated position (buy)
 */
function openPosition(symbol, price, rsiAtOpen, amount = 100) {
  const trades = loadTrades();
  const upper = symbol.toUpperCase();

  // Check if there's already an open position for this symbol
  const existing = trades.positions.find(p => p.symbol === upper);
  if (existing) {
    return { success: false, message: `Ya tienes una posición abierta en ${upper}` };
  }

  const position = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    symbol: upper,
    entryPrice: price,
    rsiAtOpen,
    amount,
    quantity: amount / price,
    openedAt: new Date().toISOString()
  };

  trades.positions.push(position);
  saveTrades(trades);
  return { success: true, position };
}

/**
 * Close a simulated position (sell)
 */
function closePosition(symbol, currentPrice, rsiAtClose) {
  const trades = loadTrades();
  const upper = symbol.toUpperCase();

  const idx = trades.positions.findIndex(p => p.symbol === upper);
  if (idx === -1) {
    return { success: false, message: `No hay posición abierta en ${upper}` };
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
    closedAt: new Date().toISOString()
  };

  // Move to history
  trades.history.push(closedTrade);
  trades.positions.splice(idx, 1);
  saveTrades(trades);

  return { success: true, trade: closedTrade };
}

/**
 * Get all open positions enriched with current prices
 */
function getOpenPositions() {
  return loadTrades().positions;
}

/**
 * Get trade history
 */
function getHistory() {
  return loadTrades().history;
}

/**
 * Get stats summary
 */
function getStats() {
  const trades = loadTrades();
  const history = trades.history;

  if (history.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      avgPnlPct: 0,
      bestTrade: null,
      worstTrade: null
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
    worstTrade: sorted[sorted.length - 1]
  };
}

module.exports = { openPosition, closePosition, getOpenPositions, getHistory, getStats };
