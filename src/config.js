/**
 * Token Configuration Store — SQLite-backed token management
 */

const { getDb } = require('./db');

const DEFAULT_TOKENS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'BNB', name: 'BNB' },
  { symbol: 'ADA', name: 'Cardano' },
];

function loadTokens() {
  const db = getDb();
  const rows = db.prepare('SELECT symbol, name FROM tokens ORDER BY sort_order').all();
  if (rows.length > 0) return rows;
  saveTokens(DEFAULT_TOKENS);
  return DEFAULT_TOKENS;
}

function saveTokens(tokens) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM tokens').run();
    const insert = db.prepare('INSERT INTO tokens (symbol, name, sort_order, added_at) VALUES (?, ?, ?, ?)');
    tokens.forEach((t, i) => insert.run(t.symbol, t.name || t.symbol, i, new Date().toISOString()));
  })();
}

function addToken(symbol, name) {
  const db = getDb();
  const upper = symbol.toUpperCase();
  const existing = db.prepare('SELECT symbol FROM tokens WHERE symbol = ?').get(upper);
  if (existing) {
    return { success: false, message: `${upper} ya está en la lista` };
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM tokens').get().m;
  db.prepare('INSERT INTO tokens (symbol, name, sort_order, added_at) VALUES (?, ?, ?, ?)')
    .run(upper, name || upper, maxOrder + 1, new Date().toISOString());
  return { success: true, message: `${upper} añadido correctamente` };
}

function removeToken(symbol) {
  const db = getDb();
  const upper = symbol.toUpperCase();
  const result = db.prepare('DELETE FROM tokens WHERE symbol = ?').run(upper);
  if (result.changes === 0) {
    return { success: false, message: `${upper} no encontrado` };
  }
  return { success: true, message: `${upper} eliminado correctamente` };
}

module.exports = { loadTokens, addToken, removeToken };
