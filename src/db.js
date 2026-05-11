/**
 * Database Module — SQLite via better-sqlite3
 *
 * Provides a singleton database connection with schema initialization
 * and auto-migration from legacy JSON files on first boot.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'cryptorsi.db');

let _db = null;

function getDb() {
  if (_db) return _db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _createTables(_db);
  _autoMigrate(_db);

  return _db;
}

function _createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL DEFAULT '1d',
      entry_price REAL NOT NULL,
      amount REAL NOT NULL,
      quantity REAL NOT NULL,
      rsi_at_open REAL,
      rsi_data TEXT,
      opened_at TEXT NOT NULL,
      UNIQUE(symbol, timeframe, user_id)
    );

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL DEFAULT '1d',
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      amount REAL NOT NULL,
      quantity REAL NOT NULL,
      exit_value REAL NOT NULL,
      pnl REAL NOT NULL,
      pnl_pct REAL NOT NULL,
      rsi_at_open REAL,
      rsi_at_close REAL,
      rsi_data TEXT,
      rsi_close_data TEXT,
      opened_at TEXT NOT NULL,
      closed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cooldowns (
      key TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rsi_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      token_data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      prices TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
    CREATE INDEX IF NOT EXISTS idx_history_closed ON history(closed_at);
    CREATE INDEX IF NOT EXISTS idx_history_symbol ON history(symbol);
    CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
    CREATE INDEX IF NOT EXISTS idx_rsi_snapshots_ts ON rsi_snapshots(timestamp);
    CREATE INDEX IF NOT EXISTS idx_price_snapshots_ts ON price_snapshots(timestamp);
  `);
}

/**
 * Auto-migrate JSON data files to SQLite on first boot.
 * Only runs when JSON source files exist AND DB tables are empty.
 * Idempotent — safe to run on every boot.
 */
function _autoMigrate(db) {
  function readJSON(filepath) {
    try {
      if (fs.existsSync(filepath)) return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch {}
    return null;
  }

  function backupJSON(filepath) {
    const bak = filepath + '.bak';
    if (!fs.existsSync(bak) && fs.existsSync(filepath)) {
      fs.renameSync(filepath, bak);
    }
  }

  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const hasData = users > 0;
  const hasJSONFiles = fs.existsSync(path.join(DATA_DIR, 'users.json'))
    || fs.existsSync(path.join(DATA_DIR, 'tokens.json'))
    || fs.existsSync(path.join(DATA_DIR, 'settings.json'));

  if (hasData || !hasJSONFiles) return;

  console.log('[MIGRATE] JSON files detected with empty DB — running auto-migration...');
  let total = 0;

  // Users
  const usersData = readJSON(path.join(DATA_DIR, 'users.json'));
  if (usersData && Array.isArray(usersData)) {
    const insert = db.prepare('INSERT OR IGNORE INTO users (id, username, password, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const u of usersData) {
      insert.run(u.id, u.username, u.password, u.displayName || u.display_name || '', u.role || 'user', u.createdAt || new Date().toISOString());
      total++;
    }
    backupJSON(path.join(DATA_DIR, 'users.json'));
    console.log(`[MIGRATE] Users: ${usersData.length}`);
  }

  // Tokens
  const tokensData = readJSON(path.join(DATA_DIR, 'tokens.json'));
  if (tokensData && Array.isArray(tokensData)) {
    const insert = db.prepare('INSERT OR IGNORE INTO tokens (symbol, name, sort_order, added_at) VALUES (?, ?, ?, ?)');
    tokensData.forEach((t, i) => { insert.run(t.symbol, t.name || t.symbol, i, new Date().toISOString()); total++; });
    backupJSON(path.join(DATA_DIR, 'tokens.json'));
    console.log(`[MIGRATE] Tokens: ${tokensData.length}`);
  }

  // Settings
  const settingsData = readJSON(path.join(DATA_DIR, 'settings.json'));
  if (settingsData) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('main', JSON.stringify(settingsData));
    total++;
    backupJSON(path.join(DATA_DIR, 'settings.json'));
    console.log('[MIGRATE] Settings: 1');
  }

  // Cooldowns
  const cooldownsData = readJSON(path.join(DATA_DIR, 'sent_signals.json'));
  if (cooldownsData && typeof cooldownsData === 'object') {
    const insert = db.prepare('INSERT OR IGNORE INTO cooldowns (key, timestamp) VALUES (?, ?)');
    let count = 0;
    for (const [key, ts] of Object.entries(cooldownsData)) {
      if (typeof ts === 'number') { insert.run(key, ts); count++; }
    }
    total += count;
    backupJSON(path.join(DATA_DIR, 'sent_signals.json'));
    if (count > 0) console.log(`[MIGRATE] Cooldowns: ${count}`);
  }

  // Trades (trades_*.json)
  const tradeFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('trades_') && f.endsWith('.json') && !f.includes('.bak'));
  for (const file of tradeFiles) {
    const userId = file.replace('trades_', '').replace('.json', '');
    const tradesData = readJSON(path.join(DATA_DIR, file));
    if (!tradesData) continue;

    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) {
      db.prepare('INSERT OR IGNORE INTO users (id, username, password, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, userId, '', userId, 'user', new Date().toISOString());
    }

    const positions = tradesData.positions || [];
    if (positions.length > 0) {
      const insertPos = db.prepare('INSERT OR IGNORE INTO positions (id, user_id, symbol, timeframe, entry_price, amount, quantity, rsi_at_open, rsi_data, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const p of positions) {
        insertPos.run(p.id, userId, p.symbol, p.timeframe || '1d', p.entryPrice, p.amount, p.quantity, p.rsiAtOpen ?? null, p.rsi ? JSON.stringify(p.rsi) : null, p.openedAt);
        total++;
      }
    }

    const history = tradesData.history || [];
    if (history.length > 0) {
      const insertHist = db.prepare('INSERT OR IGNORE INTO history (id, user_id, symbol, timeframe, entry_price, exit_price, amount, quantity, exit_value, pnl, pnl_pct, rsi_at_open, rsi_at_close, rsi_data, rsi_close_data, opened_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const t of history) {
        insertHist.run(t.id, userId, t.symbol, t.timeframe || '1d', t.entryPrice, t.exitPrice, t.amount, t.quantity, t.exitValue, t.pnl, t.pnlPct, t.rsiAtOpen ?? null, t.rsiAtClose ?? null, t.rsi ? JSON.stringify(t.rsi) : null, t.rsiClose ? JSON.stringify(t.rsiClose) : null, t.openedAt, t.closedAt);
        total++;
      }
    }
    backupJSON(path.join(DATA_DIR, file));
    console.log(`[MIGRATE] Trades (${userId}): ${positions.length} positions, ${history.length} history`);
  }

  // Historical snapshots (history/ directory)
  const historyDir = path.join(DATA_DIR, 'history');
  if (fs.existsSync(historyDir)) {
    // RSI snapshots
    const rsiFiles = fs.readdirSync(historyDir).filter(f => f.startsWith('rsi_') && f.endsWith('.json')).sort();
    if (rsiFiles.length > 0 && db.prepare('SELECT COUNT(*) as c FROM rsi_snapshots').get().c === 0) {
      const insert = db.prepare('INSERT INTO rsi_snapshots (timestamp, token_data) VALUES (?, ?)');
      let count = 0;
      for (const file of rsiFiles) {
        const snapshots = readJSON(path.join(historyDir, file));
        if (!Array.isArray(snapshots)) continue;
        for (const snap of snapshots) { insert.run(snap.timestamp || file, JSON.stringify(snap.tokens || [])); count++; }
      }
      total += count;
      console.log(`[MIGRATE] RSI snapshots: ${count} from ${rsiFiles.length} files`);
    }

    // Price snapshots
    const priceFiles = fs.readdirSync(historyDir).filter(f => f.startsWith('prices_') && f.endsWith('.json')).sort();
    if (priceFiles.length > 0 && db.prepare('SELECT COUNT(*) as c FROM price_snapshots').get().c === 0) {
      const insert = db.prepare('INSERT INTO price_snapshots (timestamp, prices) VALUES (?, ?)');
      let count = 0;
      for (const file of priceFiles) {
        const snapshots = readJSON(path.join(historyDir, file));
        if (!Array.isArray(snapshots)) continue;
        for (const snap of snapshots) { insert.run(snap.timestamp || file, JSON.stringify(snap.prices || [])); count++; }
      }
      total += count;
      console.log(`[MIGRATE] Price snapshots: ${count} from ${priceFiles.length} files`);
    }

    // Market snapshots
    const marketFiles = fs.readdirSync(historyDir).filter(f => f.startsWith('market_') && f.endsWith('.json')).sort();
    if (marketFiles.length > 0 && db.prepare('SELECT COUNT(*) as c FROM market_snapshots').get().c === 0) {
      const insert = db.prepare('INSERT INTO market_snapshots (timestamp, data) VALUES (?, ?)');
      let count = 0;
      for (const file of marketFiles) {
        const snapshots = readJSON(path.join(historyDir, file));
        if (!Array.isArray(snapshots)) continue;
        for (const snap of snapshots) { insert.run(snap.timestamp || file, JSON.stringify(snap)); count++; }
      }
      total += count;
      console.log(`[MIGRATE] Market snapshots: ${count} from ${marketFiles.length} files`);
    }
  }

  console.log(`[MIGRATE] Complete. Total rows: ${total}`);
}

function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function getDataDir() {
  return DATA_DIR;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

module.exports = { getDb, closeDb, getDataDir, ensureDataDir, DB_PATH };
