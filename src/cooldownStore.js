/**
 * Cooldown Store — SQLite-backed alert cooldown tracking
 */

const { getDb } = require('./db');

function get(key) {
  const db = getDb();
  const row = db.prepare('SELECT timestamp FROM cooldowns WHERE key = ?').get(key);
  return row ? row.timestamp : null;
}

function set(key, timestamp) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO cooldowns (key, timestamp) VALUES (?, ?)').run(key, timestamp);
}

module.exports = { get, set };
