/**
 * Centralized Persistent Storage
 *
 * All data files are stored in a single configurable directory (DATA_DIR).
 * In Coolify/Docker, mount a persistent volume to /app/data.
 *
 * DATA_DIR can be set via env var, defaults to ./data
 *
 * Files:
 *   tokens.json     - tracked tokens list
 *   trades.json     - simulated positions & history
 *   history/
 *     rsi_<date>.json       - daily RSI snapshots for all tokens
 *     market_<date>.json    - daily market sentiment snapshots
 *     prices_<date>.json    - hourly price snapshots
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function getDataDir() {
  return DATA_DIR;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureDataDir() {
  ensureDir(DATA_DIR);
}

function ensureHistoryDir() {
  ensureDir(path.join(DATA_DIR, 'history'));
}

// ============================================================
// Generic JSON read/write
// ============================================================

function readJSON(filepath, defaultValue) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${filepath}:`, e.message);
  }
  return defaultValue;
}

function writeJSON(filepath, data) {
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// ============================================================
// RSI History - snapshot per day
// ============================================================

/**
 * Save a snapshot of RSI data for all tokens.
 * Called periodically by the scheduler.
 */
function saveRSISnapshot(rsiDataArray) {
  ensureHistoryDir();
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filepath = path.join(DATA_DIR, 'history', `rsi_${date}.json`);

  let snapshots = readJSON(filepath, []);

  snapshots.push({
    timestamp: new Date().toISOString(),
    tokens: rsiDataArray.map(t => ({
      symbol: t.symbol,
      price: t.price || null,
      rsi1d: t.timeframes?.['1d']?.rsi ?? null,
      rsi4h: t.timeframes?.['4h']?.rsi ?? null,
      rsi1h: t.timeframes?.['1h']?.rsi ?? null,
      action: t.recommendation?.action || null,
    })),
  });

  writeJSON(filepath, snapshots);
  return snapshots.length;
}

/**
 * Get RSI history for a specific token.
 * Returns array of { date, rsi1d, rsi4h, rsi1h, price }
 */
function getRSIHistory(symbol, days = 30) {
  ensureHistoryDir();
  const upper = symbol.toUpperCase();
  const result = [];
  const historyDir = path.join(DATA_DIR, 'history');

  if (!fs.existsSync(historyDir)) return result;

  const files = fs.readdirSync(historyDir)
    .filter(f => f.startsWith('rsi_') && f.endsWith('.json'))
    .sort()
    .slice(-days);

  for (const file of files) {
    const filepath = path.join(historyDir, file);
    const snapshots = readJSON(filepath, []);
    const date = file.replace('rsi_', '').replace('.json', '');

    // Take the last snapshot of the day
    const last = snapshots[snapshots.length - 1];
    if (!last) continue;

    const tokenData = last.tokens?.find(t => t.symbol === upper);
    if (tokenData) {
      result.push({
        date,
        timestamp: last.timestamp,
        ...tokenData,
      });
    }
  }

  return result;
}

// ============================================================
// Market Sentiment History - snapshot per day
// ============================================================

function saveMarketSnapshot(marketData) {
  ensureHistoryDir();
  const date = new Date().toISOString().split('T')[0];
  const filepath = path.join(DATA_DIR, 'history', `market_${date}.json`);

  let snapshots = readJSON(filepath, []);

  snapshots.push({
    timestamp: new Date().toISOString(),
    symbol: marketData.symbol,
    currentPrice: marketData.currentPrice,
    sentiment: {
      score: marketData.sentiment?.score,
      overall: marketData.sentiment?.overall,
    },
    fundingRate: marketData.fundingRate?.slice(-1)?.[0]?.rate ?? null,
    longShortRatio: marketData.longShortRatio?.slice(-1)?.[0]?.ratio ?? null,
    openInterest: marketData.openInterest?.openInterest ?? null,
    takerRatio: marketData.takerVolume?.slice(-1)?.[0]?.ratio ?? null,
  });

  writeJSON(filepath, snapshots);
  return snapshots.length;
}

function getMarketHistory(days = 30) {
  ensureHistoryDir();
  const result = [];
  const historyDir = path.join(DATA_DIR, 'history');

  if (!fs.existsSync(historyDir)) return result;

  const files = fs.readdirSync(historyDir)
    .filter(f => f.startsWith('market_') && f.endsWith('.json'))
    .sort()
    .slice(-days);

  for (const file of files) {
    const filepath = path.join(historyDir, file);
    const snapshots = readJSON(filepath, []);
    const date = file.replace('market_', '').replace('.json', '');

    // Take last snapshot of the day
    const last = snapshots[snapshots.length - 1];
    if (last) {
      result.push({ date, ...last });
    }
  }

  return result;
}

// ============================================================
// Price History - hourly snapshots
// ============================================================

function savePriceSnapshot(tokensPrices) {
  ensureHistoryDir();
  const date = new Date().toISOString().split('T')[0];
  const filepath = path.join(DATA_DIR, 'history', `prices_${date}.json`);

  let snapshots = readJSON(filepath, []);

  snapshots.push({
    timestamp: new Date().toISOString(),
    prices: tokensPrices, // [{ symbol, price }]
  });

  // Keep max 24 entries per day (hourly)
  if (snapshots.length > 24) {
    snapshots = snapshots.slice(-24);
  }

  writeJSON(filepath, snapshots);
}

function getPriceHistory(symbol, days = 7) {
  ensureHistoryDir();
  const upper = symbol.toUpperCase();
  const result = [];
  const historyDir = path.join(DATA_DIR, 'history');

  if (!fs.existsSync(historyDir)) return result;

  const files = fs.readdirSync(historyDir)
    .filter(f => f.startsWith('prices_') && f.endsWith('.json'))
    .sort()
    .slice(-days);

  for (const file of files) {
    const filepath = path.join(historyDir, file);
    const snapshots = readJSON(filepath, []);

    for (const snap of snapshots) {
      const tokenPrice = snap.prices?.find(p => p.symbol === upper);
      if (tokenPrice) {
        result.push({
          timestamp: snap.timestamp,
          price: tokenPrice.price,
        });
      }
    }
  }

  return result;
}

// ============================================================
// Cleanup old files (keep last N days)
// ============================================================

function cleanupOldFiles(maxDays = 90) {
  ensureHistoryDir();
  const historyDir = path.join(DATA_DIR, 'history');
  if (!fs.existsSync(historyDir)) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const files = fs.readdirSync(historyDir);
  let removed = 0;

  for (const file of files) {
    // Extract date from filename (rsi_2026-04-16.json -> 2026-04-16)
    const match = file.match(/(\d{4}-\d{2}-\d{2})\.json$/);
    if (match && match[1] < cutoffStr) {
      fs.unlinkSync(path.join(historyDir, file));
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`Cleaned up ${removed} old history files (older than ${maxDays} days)`);
  }
}

module.exports = {
  getDataDir,
  ensureDataDir,
  ensureHistoryDir,
  readJSON,
  writeJSON,
  // RSI
  saveRSISnapshot,
  getRSIHistory,
  // Market
  saveMarketSnapshot,
  getMarketHistory,
  // Prices
  savePriceSnapshot,
  getPriceHistory,
  // Cleanup
  cleanupOldFiles,
};
