/**
 * Trades Store — SQLite-based storage for simulated trades
 * Supports multi-timeframe and multi-buy positions.
 */

const { getDb } = require('./db');
const { loadSettings } = require('./settings');

function _getRSIData(rsiData, price) {
  const signalRSI = typeof rsiData === 'number' ? rsiData : (rsiData?.signalRSI ?? rsiData);
  const sma200_1h = rsiData?.sma200_1h ?? rsiData?.sma200 ?? null;
  const sma200_4h = rsiData?.sma200_4h ?? null;
  const seguroCfg = loadSettings().seguro || {};
  const maxBelow1h = seguroCfg.maxBelow1h ?? 0.5;
  const maxBelow4h = seguroCfg.maxBelow4h ?? 4.25;
  const seguro = (price && sma200_1h && sma200_4h)
    ? (price <= sma200_1h * (1 - maxBelow1h / 100) && price >= sma200_4h * (1 - maxBelow4h / 100))
    : false;
  const rsi = typeof rsiData === 'object' && rsiData !== null
    ? { rsi15m: rsiData.rsi15m ?? null, rsi1h: rsiData.rsi1h ?? null, rsi4h: rsiData.rsi4h ?? null, rsi1d: rsiData.rsi1d ?? null, sma200: sma200_1h, sma200_1h, sma200_4h, seguro, signalRSI }
    : { signalRSI };
  return { signalRSI, rsi, seguro };
}

/**
 * Open a simulated position (buy)
 * feePercent: trading fee % (e.g. 0.1 = 0.1%). Deducted from amount on entry.
 * allowMultiple: if true, allow multiple positions per symbol+timeframe (multi-buy).
 */
function openPosition(userId, symbol, price, rsiData, amount = 100, timeframe = '1d', feePercent = 0, allowMultiple = false) {
  const db = getDb();
  const upper = symbol.toUpperCase();

  if (!allowMultiple) {
    const existing = db.prepare('SELECT id FROM positions WHERE user_id = ? AND symbol = ? AND (timeframe = ? OR (timeframe IS NULL AND ? = \'1d\'))')
      .get(userId, upper, timeframe, timeframe);
    if (existing) {
      return { success: false, message: `Ya tienes una posicion abierta en ${upper} (${timeframe})` };
    }
  }

  const { signalRSI, rsi, seguro } = _getRSIData(rsiData, price);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const feeMultiplier = 1 - (feePercent / 100);
  const effectiveAmount = amount * feeMultiplier;
  const quantity = effectiveAmount / price;

  db.prepare(`
    INSERT INTO positions (id, user_id, symbol, timeframe, entry_price, amount, quantity, rsi_at_open, rsi_data, opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, upper, timeframe, price, amount, quantity, signalRSI, JSON.stringify(rsi), new Date().toISOString());

  return {
    success: true,
    position: {
      id, symbol: upper, timeframe, entryPrice: price, rsiAtOpen: signalRSI, rsi,
      amount, quantity, feePercent, seguro, openedAt: new Date().toISOString(),
    },
  };
}

/**
 * Close a simulated position (sell)
 * feePercent: trading fee % (e.g. 0.1 = 0.1%). Deducted from exit value.
 */
function closePosition(userId, symbol, currentPrice, rsiData, timeframe = '1d', feePercent = 0) {
  const db = getDb();
  const upper = symbol.toUpperCase();

  let row = db.prepare('SELECT * FROM positions WHERE user_id = ? AND symbol = ? AND timeframe = ?')
    .get(userId, upper, timeframe);

  if (!row) {
    // Backwards compat: try finding by symbol only without timeframe
    row = db.prepare('SELECT * FROM positions WHERE user_id = ? AND symbol = ? AND timeframe IS NULL')
      .get(userId, upper);
  }

  if (!row) {
    return { success: false, message: `No hay posicion abierta en ${upper} (${timeframe})` };
  }

  const { signalRSI, rsi: rsiClose, seguro } = _getRSIData(rsiData, currentPrice);
  const feeMultiplier = 1 - (feePercent / 100);
  const exitValue = row.quantity * currentPrice * feeMultiplier;
  const pnl = exitValue - row.amount;
  const pnlPct = (pnl / row.amount) * 100;

  const closedTrade = {
    id: row.id,
    symbol: row.symbol,
    timeframe: row.timeframe || '1d',
    entryPrice: row.entry_price,
    exitPrice: currentPrice,
    amount: row.amount,
    quantity: row.quantity,
    exitValue,
    pnl,
    pnlPct,
    feePercent,
    rsiAtOpen: row.rsi_at_open,
    rsiAtClose: signalRSI,
    rsi: row.rsi_data ? JSON.parse(row.rsi_data) : null,
    rsiClose,
    seguro,
    openedAt: row.opened_at,
    closedAt: new Date().toISOString(),
  };

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM positions WHERE id = ?').run(row.id);
    db.prepare(`
      INSERT INTO history (id, user_id, symbol, timeframe, entry_price, exit_price, amount, quantity, exit_value, pnl, pnl_pct, rsi_at_open, rsi_at_close, rsi_data, rsi_close_data, opened_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      closedTrade.id, userId, closedTrade.symbol, closedTrade.timeframe,
      closedTrade.entryPrice, closedTrade.exitPrice, closedTrade.amount, closedTrade.quantity,
      closedTrade.exitValue, closedTrade.pnl, closedTrade.pnlPct,
      closedTrade.rsiAtOpen, closedTrade.rsiAtClose,
      row.rsi_data, JSON.stringify(rsiClose),
      closedTrade.openedAt, closedTrade.closedAt
    );
  });
  transaction();

  return { success: true, trade: closedTrade };
}

/**
 * Close ALL open positions for a symbol+timeframe (used by multi-buy sell).
 * Returns array of closed trades.
 */
function closeAllPositions(userId, symbol, currentPrice, rsiData, timeframe = '1d', feePercent = 0) {
  const db = getDb();
  const upper = symbol.toUpperCase();

  const rows = db.prepare('SELECT * FROM positions WHERE user_id = ? AND symbol = ? AND (timeframe = ? OR (timeframe IS NULL AND ? = \'1d\'))')
    .all(userId, upper, timeframe, timeframe);

  if (rows.length === 0) return [];

  const { signalRSI, rsi: rsiClose, seguro } = _getRSIData(rsiData, currentPrice);
  const feeMultiplier = 1 - (feePercent / 100);
  const closedTrades = [];

  const transaction = db.transaction(() => {
    for (const row of rows) {
      const exitValue = row.quantity * currentPrice * feeMultiplier;
      const pnl = exitValue - row.amount;
      const pnlPct = (pnl / row.amount) * 100;

      const closedTrade = {
        id: row.id,
        symbol: row.symbol,
        timeframe: row.timeframe || '1d',
        entryPrice: row.entry_price,
        exitPrice: currentPrice,
        amount: row.amount,
        quantity: row.quantity,
        exitValue,
        pnl,
        pnlPct,
        feePercent,
        rsiAtOpen: row.rsi_at_open,
        rsiAtClose: signalRSI,
        rsi: row.rsi_data ? JSON.parse(row.rsi_data) : null,
        rsiClose,
        seguro,
        openedAt: row.opened_at,
        closedAt: new Date().toISOString(),
      };

      db.prepare('DELETE FROM positions WHERE id = ?').run(row.id);
      db.prepare(`
        INSERT INTO history (id, user_id, symbol, timeframe, entry_price, exit_price, amount, quantity, exit_value, pnl, pnl_pct, rsi_at_open, rsi_at_close, rsi_data, rsi_close_data, opened_at, closed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        closedTrade.id, userId, closedTrade.symbol, closedTrade.timeframe,
        closedTrade.entryPrice, closedTrade.exitPrice, closedTrade.amount, closedTrade.quantity,
        closedTrade.exitValue, closedTrade.pnl, closedTrade.pnlPct,
        closedTrade.rsiAtOpen, closedTrade.rsiAtClose,
        row.rsi_data, JSON.stringify(rsiClose),
        closedTrade.openedAt, closedTrade.closedAt
      );

      closedTrades.push(closedTrade);
    }
  });
  transaction();

  return closedTrades;
}

function getOpenPositions(userId) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM positions WHERE user_id = ?').all(userId);
  return rows.map(_rowToPosition);
}

function getOpenPosition(userId, symbol, timeframe) {
  const db = getDb();
  const upper = symbol.toUpperCase();
  const row = db.prepare('SELECT * FROM positions WHERE user_id = ? AND symbol = ? AND (timeframe = ? OR (timeframe IS NULL AND ? = \'1d\'))')
    .get(userId, upper, timeframe, timeframe);
  return row ? _rowToPosition(row) : null;
}

function hasOpenPosition(userId, symbol, timeframe) {
  const db = getDb();
  const upper = symbol.toUpperCase();
  if (timeframe) {
    return !!db.prepare('SELECT id FROM positions WHERE user_id = ? AND symbol = ? AND (timeframe = ? OR (timeframe IS NULL AND ? = \'1d\'))')
      .get(userId, upper, timeframe, timeframe);
  }
  return !!db.prepare('SELECT id FROM positions WHERE user_id = ? AND symbol = ?').get(userId, upper);
}

function getHistory(userId) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM history WHERE user_id = ? ORDER BY closed_at DESC').all(userId);
  return rows.map(_rowToHistory);
}

function getPaginatedHistory(userId, opts = {}) {
  const db = getDb();
  const { page = 1, limit = 20, symbol, timeframe, from, to, sort = 'closed_at', order = 'desc' } = opts;
  const validLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
  const validPage = Math.max(parseInt(page) || 1, 1);
  const offset = (validPage - 1) * validLimit;

  const allowedSorts = ['closed_at', 'opened_at', 'symbol', 'pnl', 'pnl_pct'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'closed_at';
  const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const conditions = ['user_id = ?'];
  const params = [userId];

  if (symbol) { conditions.push('symbol = ?'); params.push(symbol.toUpperCase()); }
  if (timeframe) { conditions.push('timeframe = ?'); params.push(timeframe); }
  if (from) { conditions.push('closed_at >= ?'); params.push(from); }
  if (to) { conditions.push('closed_at <= ?'); params.push(to + 'T23:59:59'); }

  const where = 'WHERE ' + conditions.join(' AND ');

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM history ${where}`).get(...params);
  const total = countRow.total;

  const rows = db.prepare(`SELECT * FROM history ${where} ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`).all(...params, validLimit, offset);
  const trades = rows.map(_rowToHistory);

  const filteredStats = db.prepare(`SELECT
    COALESCE(SUM(pnl), 0) as filteredPnl,
    COUNT(*) as filteredTrades,
    SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as filteredWins
    FROM history ${where}`).get(...params);

  return {
    trades,
    pagination: { page: validPage, limit: validLimit, total, totalPages: Math.ceil(total / validLimit) },
    stats: { filteredPnl: filteredStats.filteredPnl, filteredTrades: filteredStats.filteredTrades, filteredWins: filteredStats.filteredWins },
  };
}

function getStats(userId, opts = {}) {
  const db = getDb();

  const conditions = ['user_id = ?'];
  const params = [userId];
  if (opts.from) { conditions.push('closed_at >= ?'); params.push(opts.from); }
  if (opts.to) { conditions.push('closed_at <= ?'); params.push(opts.to + 'T23:59:59'); }
  const where = 'WHERE ' + conditions.join(' AND ');

  const row = db.prepare(`
    SELECT
      COUNT(*) as totalTrades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END) as losses,
      COALESCE(SUM(pnl), 0) as totalPnl,
      COALESCE(AVG(pnl_pct), 0) as avgPnlPct
    FROM history ${where}
  `).get(...params);

  if (!row || row.totalTrades === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      totalPnl: 0, avgPnlPct: 0, bestTrade: null, worstTrade: null,
    };
  }

  const best = db.prepare(`SELECT * FROM history ${where} ORDER BY pnl DESC LIMIT 1`).get(...params);
  const worst = db.prepare(`SELECT * FROM history ${where} ORDER BY pnl ASC LIMIT 1`).get(...params);

  return {
    totalTrades: row.totalTrades,
    wins: row.wins,
    losses: row.losses,
    winRate: (row.wins / row.totalTrades) * 100,
    totalPnl: row.totalPnl,
    avgPnlPct: row.avgPnlPct,
    bestTrade: best ? _rowToHistory(best) : null,
    worstTrade: worst ? _rowToHistory(worst) : null,
  };
}

function _rowToPosition(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    timeframe: row.timeframe || '1d',
    entryPrice: row.entry_price,
    rsiAtOpen: row.rsi_at_open,
    rsi: row.rsi_data ? JSON.parse(row.rsi_data) : null,
    amount: row.amount,
    quantity: row.quantity,
    openedAt: row.opened_at,
  };
}

function _rowToHistory(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    timeframe: row.timeframe || '1d',
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    amount: row.amount,
    quantity: row.quantity,
    exitValue: row.exit_value,
    pnl: row.pnl,
    pnlPct: row.pnl_pct,
    rsiAtOpen: row.rsi_at_open,
    rsiAtClose: row.rsi_at_close,
    rsi: row.rsi_data ? JSON.parse(row.rsi_data) : null,
    rsiClose: row.rsi_close_data ? JSON.parse(row.rsi_close_data) : null,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

module.exports = { openPosition, closePosition, closeAllPositions, getOpenPositions, getOpenPosition, hasOpenPosition, getHistory, getPaginatedHistory, getStats };
