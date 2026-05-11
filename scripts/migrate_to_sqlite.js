#!/usr/bin/env node
/**
 * Migrate JSON data files to SQLite database.
 *
 * Usage: node scripts/migrate_to_sqlite.js
 *
 * Reads all JSON files from data/ directory, inserts into SQLite tables,
 * then renames original files to .bak.
 *
 * Safe to run multiple times — skips if data already exists in DB.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'cryptorsi.db');

function readJSON(filepath) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${filepath}: ${e.message}`);
  }
  return null;
}

function backupFile(filepath) {
  const bak = filepath + '.bak';
  if (!fs.existsSync(bak)) {
    fs.renameSync(filepath, bak);
    console.log(`  Backed up: ${path.basename(filepath)} → ${path.basename(bak)}`);
  } else {
    console.log(`  Backup exists, keeping: ${path.basename(filepath)}`);
  }
}

function main() {
  console.log('=== JSON → SQLite Migration ===\n');
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`DB path:  ${DB_PATH}\n`);

  // Ensure data dir exists
  if (!fs.existsSync(DATA_DIR)) {
    console.log('Data directory does not exist. Nothing to migrate.');
    process.exit(0);
  }

  // Initialize DB (this also creates tables)
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
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

  let totalRows = 0;

  // 1. Migrate users.json
  const usersData = readJSON(path.join(DATA_DIR, 'users.json'));
  if (usersData && Array.isArray(usersData)) {
    const existing = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    if (existing === 0) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password, display_name, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      let count = 0;
      for (const u of usersData) {
        insert.run(u.id, u.username, u.password, u.displayName || u.display_name || '', u.role || 'user', u.createdAt || new Date().toISOString());
        count++;
      }
      console.log(`Users: migrated ${count} rows`);
      totalRows += count;
    } else {
      console.log(`Users: skipped (${existing} already in DB)`);
    }
    backupFile(path.join(DATA_DIR, 'users.json'));
  } else {
    console.log('Users: no data to migrate');
  }

  // 2. Migrate tokens.json
  const tokensData = readJSON(path.join(DATA_DIR, 'tokens.json'));
  if (tokensData && Array.isArray(tokensData)) {
    const existing = db.prepare('SELECT COUNT(*) as c FROM tokens').get().c;
    if (existing === 0) {
      const insert = db.prepare(`INSERT OR IGNORE INTO tokens (symbol, name, sort_order, added_at) VALUES (?, ?, ?, ?)`);
      let count = 0;
      tokensData.forEach((t, i) => {
        insert.run(t.symbol, t.name || t.symbol, i, new Date().toISOString());
        count++;
      });
      console.log(`Tokens: migrated ${count} rows`);
      totalRows += count;
    } else {
      console.log(`Tokens: skipped (${existing} already in DB)`);
    }
    backupFile(path.join(DATA_DIR, 'tokens.json'));
  } else {
    console.log('Tokens: no data to migrate');
  }

  // 3. Migrate settings.json
  const settingsData = readJSON(path.join(DATA_DIR, 'settings.json'));
  if (settingsData) {
    const existing = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
    if (existing === 0) {
      const insert = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
      insert.run('main', JSON.stringify(settingsData));
      console.log('Settings: migrated 1 row');
      totalRows++;
    } else {
      console.log('Settings: skipped (already in DB)');
    }
    backupFile(path.join(DATA_DIR, 'settings.json'));
  } else {
    console.log('Settings: no data to migrate');
  }

  // 4. Migrate cooldowns (sent_signals.json)
  const cooldownsData = readJSON(path.join(DATA_DIR, 'sent_signals.json'));
  if (cooldownsData && typeof cooldownsData === 'object') {
    const existing = db.prepare('SELECT COUNT(*) as c FROM cooldowns').get().c;
    if (existing === 0) {
      const insert = db.prepare(`INSERT OR IGNORE INTO cooldowns (key, timestamp) VALUES (?, ?)`);
      let count = 0;
      for (const [key, ts] of Object.entries(cooldownsData)) {
        if (typeof ts === 'number') {
          insert.run(key, ts);
          count++;
        }
      }
      console.log(`Cooldowns: migrated ${count} rows`);
      totalRows += count;
    } else {
      console.log('Cooldowns: skipped (already in DB)');
    }
    backupFile(path.join(DATA_DIR, 'sent_signals.json'));
  } else {
    console.log('Cooldowns: no data to migrate');
  }

  // 5. Migrate trades files (trades_*.json)
  const tradeFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('trades_') && f.endsWith('.json'));
  for (const file of tradeFiles) {
    const userId = file.replace('trades_', '').replace('.json', '');
    const tradesData = readJSON(path.join(DATA_DIR, file));
    if (!tradesData) continue;

    // Ensure user exists
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!userExists) {
      db.prepare('INSERT OR IGNORE INTO users (id, username, password, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, userId, '', userId, 'user', new Date().toISOString());
    }

    // Migrate positions
    const positions = tradesData.positions || [];
    if (positions.length > 0) {
      const insertPos = db.prepare(`
        INSERT OR IGNORE INTO positions (id, user_id, symbol, timeframe, entry_price, amount, quantity, rsi_at_open, rsi_data, opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let posCount = 0;
      for (const p of positions) {
        insertPos.run(
          p.id, userId, p.symbol, p.timeframe || '1d',
          p.entryPrice, p.amount, p.quantity,
          p.rsiAtOpen ?? null,
          p.rsi ? JSON.stringify(p.rsi) : null,
          p.openedAt
        );
        posCount++;
      }
      console.log(`Positions (${userId}): migrated ${posCount} rows`);
      totalRows += posCount;
    }

    // Migrate history
    const history = tradesData.history || [];
    if (history.length > 0) {
      const insertHist = db.prepare(`
        INSERT OR IGNORE INTO history (id, user_id, symbol, timeframe, entry_price, exit_price, amount, quantity, exit_value, pnl, pnl_pct, rsi_at_open, rsi_at_close, rsi_data, rsi_close_data, opened_at, closed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let histCount = 0;
      for (const t of history) {
        insertHist.run(
          t.id, userId, t.symbol, t.timeframe || '1d',
          t.entryPrice, t.exitPrice, t.amount, t.quantity, t.exitValue,
          t.pnl, t.pnlPct,
          t.rsiAtOpen ?? null,
          t.rsiAtClose ?? null,
          t.rsi ? JSON.stringify(t.rsi) : null,
          t.rsiClose ? JSON.stringify(t.rsiClose) : null,
          t.openedAt, t.closedAt
        );
        histCount++;
      }
      console.log(`History (${userId}): migrated ${histCount} rows`);
      totalRows += histCount;
    }

    backupFile(path.join(DATA_DIR, file));
  }

  // 6. Migrate history files (rsi_*, market_*, prices_*)
  const historyDir = path.join(DATA_DIR, 'history');
  if (fs.existsSync(historyDir)) {
    // RSI snapshots
    const rsiFiles = fs.readdirSync(historyDir).filter(f => f.startsWith('rsi_') && f.endsWith('.json')).sort();
    if (rsiFiles.length > 0) {
      const existing = db.prepare('SELECT COUNT(*) as c FROM rsi_snapshots').get().c;
      if (existing === 0) {
        const insert = db.prepare('INSERT INTO rsi_snapshots (timestamp, token_data) VALUES (?, ?)');
        let count = 0;
        for (const file of rsiFiles) {
          const snapshots = readJSON(path.join(historyDir, file));
          if (!Array.isArray(snapshots)) continue;
          for (const snap of snapshots) {
            insert.run(snap.timestamp || file, JSON.stringify(snap.tokens || []));
            count++;
          }
        }
        console.log(`RSI snapshots: migrated ${count} rows from ${rsiFiles.length} files`);
        totalRows += count;
      } else {
        console.log('RSI snapshots: skipped (already in DB)');
      }
    }

    // Market snapshots
    const marketFiles = fs.readdirSync(historyDir).filter(f => f.startsWith('market_') && f.endsWith('.json')).sort();
    if (marketFiles.length > 0) {
      const existing = db.prepare('SELECT COUNT(*) as c FROM market_snapshots').get().c;
      if (existing === 0) {
        const insert = db.prepare('INSERT INTO market_snapshots (timestamp, data) VALUES (?, ?)');
        let count = 0;
        for (const file of marketFiles) {
          const snapshots = readJSON(path.join(historyDir, file));
          if (!Array.isArray(snapshots)) continue;
          for (const snap of snapshots) {
            insert.run(snap.timestamp || file, JSON.stringify(snap));
            count++;
          }
        }
        console.log(`Market snapshots: migrated ${count} rows from ${marketFiles.length} files`);
        totalRows += count;
      } else {
        console.log('Market snapshots: skipped (already in DB)');
      }
    }

    // Price snapshots
    const priceFiles = fs.readdirSync(historyDir).filter(f => f.startsWith('prices_') && f.endsWith('.json')).sort();
    if (priceFiles.length > 0) {
      const existing = db.prepare('SELECT COUNT(*) as c FROM price_snapshots').get().c;
      if (existing === 0) {
        const insert = db.prepare('INSERT INTO price_snapshots (timestamp, prices) VALUES (?, ?)');
        let count = 0;
        for (const file of priceFiles) {
          const snapshots = readJSON(path.join(historyDir, file));
          if (!Array.isArray(snapshots)) continue;
          for (const snap of snapshots) {
            insert.run(snap.timestamp || file, JSON.stringify(snap.prices || []));
            count++;
          }
        }
        console.log(`Price snapshots: migrated ${count} rows from ${priceFiles.length} files`);
        totalRows += count;
      } else {
        console.log('Price snapshots: skipped (already in DB)');
      }
    }
  }

  db.close();

  console.log(`\nMigration complete. Total rows migrated: ${totalRows}`);
  console.log(`Database: ${DB_PATH}`);
}

main().then ? main().catch(e => { console.error('Migration failed:', e); process.exit(1); }) : undefined;
