/**
 * Storage Module — SQLite-backed data persistence
 *
 * Replaces the old JSON file-based storage with SQLite.
 * Provides RSI, market, and price history storage with query capabilities.
 */

const path = require('path');
const { getDb, getDataDir, ensureDataDir } = require('./db');

module.exports = { getDataDir, ensureDataDir, readJSON, writeJSON, saveRSISnapshot, getRSIHistory, saveMarketSnapshot, getMarketHistory, savePriceSnapshot, getPriceHistory, cleanupOldData };

// Legacy compatibility — used only during migration or fallback
function readJSON(filepath, defaultValue) {
  try {
    const fs = require('fs');
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${filepath}: ${e.message}`);
  }
  return defaultValue;
}

function writeJSON(filepath, data) {
  const fs = require('fs');
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// ============================================================
// RSI History
// ============================================================

function saveRSISnapshot(rsiDataArray) {
  const db = getDb();
  db.prepare('INSERT INTO rsi_snapshots (timestamp, token_data) VALUES (?, ?)').run(
    new Date().toISOString(),
    JSON.stringify(rsiDataArray.map(t => ({
      symbol: t.symbol,
      price: t.price || null,
      rsi15m: t.timeframes?.['15m']?.rsi ?? null,
      rsi1h: t.timeframes?.['1h']?.rsi ?? null,
      rsi4h: t.timeframes?.['4h']?.rsi ?? null,
      rsi1d: t.timeframes?.['1d']?.rsi ?? null,
      action: t.recommendation?.action || null,
    })))
  );
}

function getRSIHistory(symbol, days = 30) {
  const db = getDb();
  const upper = symbol.toUpperCase();
  const rows = db.prepare(`
    SELECT timestamp, token_data FROM rsi_snapshots
    WHERE timestamp >= datetime('now', '-' || ? || ' days')
    ORDER BY timestamp ASC
  `).all(days);

  const result = [];
  for (const row of rows) {
    try {
      const tokens = JSON.parse(row.token_data);
      const tokenData = tokens.find(t => t.symbol === upper);
      if (tokenData) {
        result.push({
          date: row.timestamp.split('T')[0],
          timestamp: row.timestamp,
          ...tokenData,
        });
      }
    } catch (e) { /* skip malformed */ }
  }
  return result;
}

// ============================================================
// Market Sentiment History
// ============================================================

function saveMarketSnapshot(marketData) {
  const db = getDb();
  db.prepare('INSERT INTO market_snapshots (timestamp, data) VALUES (?, ?)').run(
    new Date().toISOString(),
    JSON.stringify({
      symbol: marketData.symbol,
      currentPrice: marketData.currentPrice,
      sentiment: marketData.sentiment,
      fundingRate: marketData.fundingRate?.slice(-1)?.[0]?.rate ?? null,
      longShortRatio: marketData.longShortRatio?.slice(-1)?.[0]?.ratio ?? null,
      openInterest: marketData.openInterest?.openInterest ?? null,
      takerRatio: marketData.takerVolume?.slice(-1)?.[0]?.ratio ?? null,
    })
  );
}

function getMarketHistory(days = 30) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT timestamp, data FROM market_snapshots
    WHERE timestamp >= datetime('now', '-' || ? || ' days')
    ORDER BY timestamp ASC
  `).all(days);

  return rows.map(row => {
    try {
      return { date: row.timestamp.split('T')[0], timestamp: row.timestamp, ...JSON.parse(row.data) };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

// ============================================================
// Price History
// ============================================================

function savePriceSnapshot(tokensPrices) {
  const db = getDb();
  db.prepare('INSERT INTO price_snapshots (timestamp, prices) VALUES (?, ?)').run(
    new Date().toISOString(),
    JSON.stringify(tokensPrices)
  );
}

function getPriceHistory(symbol, days = 7) {
  const db = getDb();
  const upper = symbol.toUpperCase();
  const rows = db.prepare(`
    SELECT timestamp, prices FROM price_snapshots
    WHERE timestamp >= datetime('now', '-' || ? || ' days')
    ORDER BY timestamp ASC
  `).all(days);

  const result = [];
  for (const row of rows) {
    try {
      const prices = JSON.parse(row.prices);
      const tokenPrice = prices.find(p => p.symbol === upper);
      if (tokenPrice) {
        result.push({ timestamp: row.timestamp, price: tokenPrice.price });
      }
    } catch (e) { /* skip */ }
  }
  return result;
}

// ============================================================
// Cleanup old snapshots (keep last N days)
// ============================================================

function cleanupOldData(maxDays = 90) {
  const db = getDb();
  const tables = ['rsi_snapshots', 'market_snapshots', 'price_snapshots'];
  let totalRemoved = 0;
  for (const table of tables) {
    const result = db.prepare(`DELETE FROM ${table} WHERE timestamp < datetime('now', '-' || ? || ' days')`).run(maxDays);
    totalRemoved += result.changes;
  }
  if (totalRemoved > 0) {
    console.log(`Cleaned up ${totalRemoved} old snapshots (older than ${maxDays} days)`);
  }
}
