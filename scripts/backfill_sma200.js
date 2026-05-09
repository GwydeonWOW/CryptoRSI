#!/usr/bin/env node
/**
 * Backfill SMA200 and missing RSI data for existing trades.
 *
 * For trades where rsi.sma200 or rsiClose.sma200 is null, fetches
 * historical 1h candles from Binance up to the trade's timestamp
 * and calculates the missing values.
 *
 * Usage: node scripts/backfill_sma200.js
 */

const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const BINANCE_BASE = 'https://api.binance.com';

// Resolve data dir (same logic as storage.js)
const DATA_DIR = path.join(__dirname, '..', 'data');
const TRADES_FILE = path.join(DATA_DIR, 'trades_admin_001.json');

function calculateSMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  }
  return 100 - 100 / (1 + rs);
}

async function fetchHistoricalCandles(symbol, interval, endTime, limit = 250) {
  const binanceSymbol = symbol.toUpperCase().includes('USDT')
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}&endTime=${endTime}`;

  const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });
  if (!res.ok) throw new Error(`Binance ${res.status}: ${res.statusText}`);

  const data = await res.json();
  if (data.code) throw new Error(`Binance error: ${data.msg}`);

  return data.map(k => ({
    timestamp: k[0],
    close: parseFloat(k[4]),
  }));
}

async function backfillRSIData(entries, label) {
  let filled = 0;

  for (const entry of entries) {
    const ts = entry.openedAt || entry.timestamp;
    if (!ts) continue;

    const needsOpenSMA = entry.rsi && entry.rsi.sma200 == null;
    const needsCloseSMA = entry.rsiClose && entry.rsiClose.sma200 == null;
    const needsOpenRSI = entry.rsi && (
      entry.rsi.rsi15m == null || entry.rsi.rsi1h == null ||
      entry.rsi.rsi4h == null || entry.rsi.rsi1d == null
    );

    if (!needsOpenSMA && !needsCloseSMA && !needsOpenRSI) continue;

    const endTime = new Date(ts).getTime();

    // Fetch 1h candles for SMA200
    if (needsOpenSMA) {
      try {
        const candles = await fetchHistoricalCandles(entry.symbol, '1h', endTime);
        const closes = candles.map(c => c.close);
        if (closes.length >= 200) {
          entry.rsi.sma200 = calculateSMA(closes, 200);
          console.log(`  ${label} ${entry.symbol} sma200 (open) → ${entry.rsi.sma200}`);
          filled++;
        } else {
          console.log(`  ${label} ${entry.symbol} sma200 skip — only ${closes.length} hourly candles`);
        }
      } catch (e) {
        console.log(`  ${label} ${entry.symbol} sma200 error: ${e.message}`);
      }
      await sleep(200);
    }

    // Fetch other timeframe RSI for open
    if (needsOpenRSI) {
      for (const tf of ['15m', '1h', '4h', '1d']) {
        if (entry.rsi[`rsi${tf.replace('m', 'm')}`] != null) continue;
        // Map timeframe to actual key name
        const key = tf === '15m' ? 'rsi15m' : tf === '1h' ? 'rsi1h' : tf === '4h' ? 'rsi4h' : 'rsi1d';
        if (entry.rsi[key] != null) continue;

        try {
          const candles = await fetchHistoricalCandles(entry.symbol, tf, endTime, 100);
          const closes = candles.map(c => c.close);
          if (closes.length > 15) {
            entry.rsi[key] = calculateRSI(closes);
            console.log(`  ${label} ${entry.symbol} ${tf} RSI (open) → ${entry.rsi[key]?.toFixed(1)}`);
            filled++;
          }
        } catch (e) {
          console.log(`  ${label} ${entry.symbol} ${tf} RSI error: ${e.message}`);
        }
        await sleep(200);
      }
    }

    // Close data
    if (needsCloseSMA && entry.closedAt) {
      const closeEndTime = new Date(entry.closedAt).getTime();
      try {
        const candles = await fetchHistoricalCandles(entry.symbol, '1h', closeEndTime);
        const closes = candles.map(c => c.close);
        if (closes.length >= 200) {
          entry.rsiClose.sma200 = calculateSMA(closes, 200);
          console.log(`  ${label} ${entry.symbol} sma200 (close) → ${entry.rsiClose.sma200}`);
          filled++;
        }
      } catch (e) {
        console.log(`  ${label} ${entry.symbol} sma200 close error: ${e.message}`);
      }
      await sleep(200);
    }
  }

  return filled;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== SMA200 & RSI Backfill Script ===\n');

  if (!fs.existsSync(TRADES_FILE)) {
    console.log('No trades file found at', TRADES_FILE);
    process.exit(1);
  }

  const trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf-8'));
  console.log(`Loaded: ${trades.positions.length} positions, ${trades.history.length} history entries\n`);

  // Backup original
  const backupPath = TRADES_FILE + '.backup';
  fs.writeFileSync(backupPath, JSON.stringify(trades, null, 2));
  console.log(`Backup saved: ${backupPath}\n`);

  let totalFilled = 0;

  if (trades.positions.length > 0) {
    console.log('--- Open Positions ---');
    totalFilled += await backfillRSIData(trades.positions, 'POS');
  }

  if (trades.history.length > 0) {
    console.log('\n--- Closed Trades ---');
    totalFilled += await backfillRSIData(trades.history, 'HIST');
  }

  if (totalFilled > 0) {
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
    console.log(`\n✓ Updated ${totalFilled} fields. Trades file saved.`);
  } else {
    console.log('\nNo missing data found. Nothing to update.');
  }

  console.log('\nDone.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
