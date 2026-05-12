/**
 * Snapshot Service — Data collection, RSI fetching, auto-trading
 */

const { calculateRSI, getRecommendation, calculateMultiTimeframeRSI } = require('../rsi');
const { fetchCandles, fetchCurrentPrice, calculateSMA } = require('../api');
const { loadTokens } = require('../config');
const { openPosition, closePosition, hasOpenPosition } = require('../trades');
const { getMarketAnalysis } = require('../futures');
const {
  saveRSISnapshot, saveMarketSnapshot, savePriceSnapshot,
} = require('../storage');
const { loadSettings } = require('../settings');
const logger = require('../logger');

let lastSnapshot = null;
let lastSnapshotTime = 0;
const SNAPSHOT_SERVE_MS = 4 * 60 * 1000; // 4 min cache — less than interval to avoid stale

function getLastSnapshot() {
  if (lastSnapshot && Date.now() - lastSnapshotTime < SNAPSHOT_SERVE_MS) {
    return { data: lastSnapshot, time: lastSnapshotTime };
  }
  return null;
}

async function fetchAllRSI() {
  const tokens = loadTokens();
  const timeframes = ['15m', '1h', '4h', '1d'];

  const results = await Promise.allSettled(
    tokens.map(async (token) => {
      try {
        const candlesByTimeframe = {};
        const fetches = timeframes.map(async tf => {
          try {
            const { candles } = await fetchCandles(token.symbol, tf);
            return { tf, closes: candles.map(c => c.close) };
          } catch (e) {
            return { tf, closes: [] };
          }
        });
        const fetchResults = await Promise.all(fetches);
        for (const r of fetchResults) {
          if (r.closes.length > 0) candlesByTimeframe[r.tf] = r.closes;
        }

        const rsiData = calculateMultiTimeframeRSI(candlesByTimeframe, 14);
        const { price } = await fetchCurrentPrice(token.symbol);
        const primaryTF = rsiData['15m']?.rsi !== null ? '15m'
          : rsiData['1h']?.rsi !== null ? '1h'
          : rsiData['4h']?.rsi !== null ? '4h' : '1d';
        const primaryRSI = rsiData[primaryTF]?.rsi || null;
        const primaryDivergence = rsiData[primaryTF]?.divergence || null;
        const recommendation = primaryRSI !== null ? getRecommendation(primaryRSI, primaryDivergence) : null;

        return {
          symbol: token.symbol, name: token.name, price,
          primaryRSI, primaryTimeframe: primaryTF, divergence: primaryDivergence,
          recommendation, timeframes: rsiData,
        };
      } catch (e) {
        return { symbol: token.symbol, name: token.name, error: e.message };
      }
    })
  );

  return results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
}

const AUTO_TRADER_USER = 'admin_001';

async function fetchEnrichedRSI(symbol) {
  const timeframes = ['15m', '1h', '4h', '1d'];
  const rsiData = { rsi15m: null, rsi1h: null, rsi4h: null, rsi1d: null, sma200_1h: null, sma200_4h: null, signalRSI: null };

  try {
    const candlesByTimeframe = {};
    const fetches = timeframes.map(async tf => {
      try {
        const { candles } = await fetchCandles(symbol, tf);
        return { tf, closes: candles.map(c => c.close) };
      } catch (e) { return { tf, closes: [] }; }
    });
    const results = await Promise.all(fetches);
    for (const r of results) {
      if (r.closes.length > 0) candlesByTimeframe[r.tf] = r.closes;
    }
    const rsi = calculateMultiTimeframeRSI(candlesByTimeframe, 14);
    rsiData.rsi15m = rsi['15m']?.rsi ?? null;
    rsiData.rsi1h = rsi['1h']?.rsi ?? null;
    rsiData.rsi4h = rsi['4h']?.rsi ?? null;
    rsiData.rsi1d = rsi['1d']?.rsi ?? null;
    rsiData.signalRSI = rsiData.rsi1d;

    try {
      const { candles: hourlyCandles } = await fetchCandles(symbol, '1h', 250);
      rsiData.sma200_1h = calculateSMA(hourlyCandles.map(c => c.close), 200);
    } catch (e) { /* SMA 1h optional */ }
    try {
      const { candles: fourHCandles } = await fetchCandles(symbol, '4h', 250);
      rsiData.sma200_4h = calculateSMA(fourHCandles.map(c => c.close), 200);
    } catch (e) { /* SMA 4h optional */ }
  } catch (e) { /* RSI optional */ }

  return rsiData;
}

async function runAutoTrader(rsiDataArray, settings) {
  const sim = settings.simulation || {};
  if (!sim.enabled) {
    logger.info('[SIM] Skipped: simulation disabled');
    return;
  }

  const tfConfigs = sim.timeframes || {};
  const amount = sim.amount || 1000;
  const feePercent = sim.feePercent || 0;
  const activeTFs = Object.entries(tfConfigs).filter(([, c]) => c.enabled);

  if (activeTFs.length === 0) {
    logger.info('[SIM] Skipped: no timeframes enabled');
    return;
  }

  logger.info(`[SIM] Checking ${rsiDataArray.length} tokens | Amount: $${amount} | TFs: ${activeTFs.map(([tf]) => tf).join(',')}`);

  for (const token of rsiDataArray) {
    if (token.error) continue;

    for (const [tf, config] of activeTFs) {
      let rsi = token.timeframes?.[tf]?.rsi;
      let rsiSource = 'batch';

      if (rsi === null || rsi === undefined) {
        const hasPos = hasOpenPosition(AUTO_TRADER_USER, token.symbol, tf);
        if (hasPos) {
          logger.info(`[SIM] RETRY: ${token.symbol} (${tf}) has open position but batch RSI is null — fetching directly...`);
          try {
            const { candles } = await fetchCandles(token.symbol, tf);
            const closes = candles.map(c => c.close);
            const rsiValues = calculateRSI(closes);
            rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
            if (rsi !== null) {
              rsiSource = 'retry';
              logger.info(`[SIM] RETRY OK: ${token.symbol} (${tf}) RSI=${rsi.toFixed(1)}`);
            } else {
              logger.info(`[SIM] RETRY FAILED: ${token.symbol} (${tf}) — could not calculate RSI from ${closes.length} candles`);
            }
          } catch (e) {
            logger.info(`[SIM] RETRY ERROR: ${token.symbol} (${tf}) ${e.message}`);
          }
        }
        if (rsi === null || rsi === undefined) continue;
      }

      const rsiData = {
        rsi15m: token.timeframes?.['15m']?.rsi ?? null,
        rsi1h: token.timeframes?.['1h']?.rsi ?? null,
        rsi4h: token.timeframes?.['4h']?.rsi ?? null,
        rsi1d: token.timeframes?.['1d']?.rsi ?? null,
        sma200_1h: token.sma200_1h ?? null,
        sma200_4h: token.sma200_4h ?? null,
        signalRSI: rsi,
      };

      if (rsi <= (config.rsiOversold || 30)) {
        if (!hasOpenPosition(AUTO_TRADER_USER, token.symbol, tf)) {
          const result = openPosition(AUTO_TRADER_USER, token.symbol, token.price, rsiData, amount, tf, feePercent);
          if (result.success) {
            logger.info(`[SIM] BUY ${token.symbol} @ $${token.price?.toFixed(2)} | RSI ${rsi.toFixed(1)} (${tf}) | $${amount}`);
          }
        } else {
          logger.info(`[SIM] SKIP BUY ${token.symbol} (${tf}) | RSI ${rsi.toFixed(1)} <= ${config.rsiOversold || 30} but position open`);
        }
      }

      if (rsi >= (config.rsiOverbought || 70)) {
        if (hasOpenPosition(AUTO_TRADER_USER, token.symbol, tf)) {
          const result = closePosition(AUTO_TRADER_USER, token.symbol, token.price, rsiData, tf, feePercent);
          if (result.success) {
            const pnlStr = result.trade.pnl >= 0 ? `+$${result.trade.pnl.toFixed(2)}` : `-$${Math.abs(result.trade.pnl).toFixed(2)}`;
            logger.info(`[SIM] SELL ${token.symbol} @ $${token.price?.toFixed(2)} | RSI ${rsi.toFixed(1)} (${tf}) | ${pnlStr} (${result.trade.pnlPct.toFixed(1)}%)${rsiSource === 'retry' ? ' [RETRY]' : ''}`);
          }
        } else {
          logger.info(`[SIM] SKIP SELL ${token.symbol} (${tf}) | RSI ${rsi.toFixed(1)} >= ${config.rsiOverbought || 70} but no position`);
        }
      }
    }
  }
}

async function collectSnapshot(dispatchAlertsFn) {
  logger.info('Collecting data snapshot...');

  try {
    const tokens = loadTokens();
    const timeframes = ['15m', '1h', '4h', '1d'];

    const rsiResults = await Promise.allSettled(
      tokens.map(async (token) => {
        try {
          const candlesByTimeframe = {};
          const fetches = timeframes.map(async tf => {
            try {
              const { candles } = await fetchCandles(token.symbol, tf);
              return { tf, closes: candles.map(c => c.close) };
            } catch (e) {
              return { tf, closes: [] };
            }
          });
          const results = await Promise.all(fetches);
          for (const r of results) {
            if (r.closes.length > 0) candlesByTimeframe[r.tf] = r.closes;
          }

          const rsiData = calculateMultiTimeframeRSI(candlesByTimeframe, 14);
          const { price } = await fetchCurrentPrice(token.symbol);
          const primaryTF = rsiData['15m']?.rsi !== null ? '15m'
            : rsiData['1h']?.rsi !== null ? '1h'
            : rsiData['4h']?.rsi !== null ? '4h' : '1d';
          const primaryRSI = rsiData[primaryTF]?.rsi || null;
          const primaryDivergence = rsiData[primaryTF]?.divergence || null;
          const recommendation = primaryRSI !== null ? getRecommendation(primaryRSI, primaryDivergence) : null;

          let sma200_1h = null, sma200_4h = null;
          try {
            const { candles: hourlyCandles } = await fetchCandles(token.symbol, '1h', 250);
            sma200_1h = calculateSMA(hourlyCandles.map(c => c.close), 200);
          } catch (e) { /* SMA 1h unavailable */ }
          try {
            const { candles: fourHCandles } = await fetchCandles(token.symbol, '4h', 250);
            sma200_4h = calculateSMA(fourHCandles.map(c => c.close), 200);
          } catch (e) { /* SMA 4h unavailable */ }

          return {
            symbol: token.symbol, name: token.name, price, sma200_1h, sma200_4h,
            primaryRSI, primaryTimeframe: primaryTF,
            divergence: primaryDivergence, recommendation, timeframes: rsiData,
          };
        } catch (e) {
          return { symbol: token.symbol, error: e.message };
        }
      })
    );

    const rsiDataArray = rsiResults
      .filter(r => r.status === 'fulfilled' && !r.value.error)
      .map(r => r.value);

    if (rsiDataArray.length > 0) {
      saveRSISnapshot(rsiDataArray);
      lastSnapshot = rsiDataArray;
      lastSnapshotTime = Date.now();
      logger.info({ tokens: rsiDataArray.length }, 'RSI snapshot saved');

      const nullTFs = rsiDataArray
        .map(t => {
          const missing = ['15m', '1h', '4h', '1d'].filter(tf => t.timeframes?.[tf]?.rsi == null);
          return missing.length > 0 ? `${t.symbol}(null: ${missing.join(',')})` : null;
        })
        .filter(Boolean);
      if (nullTFs.length > 0) logger.info({ nullTFs }, 'Null timeframes detected');

      const divergences = rsiDataArray.filter(t => t.divergence?.bullish || t.divergence?.bearish);
      if (divergences.length > 0) {
        logger.info({ divergences: divergences.map(t => `${t.symbol}(${t.divergence.bullish ? 'BULL' : 'BEAR'})`) }, 'Divergences detected');
      }
      const extremes = rsiDataArray.filter(t => t.primaryRSI !== null && (t.primaryRSI <= 30 || t.primaryRSI >= 70));
      if (extremes.length > 0) {
        logger.info({ extremes: extremes.map(t => `${t.symbol}(${t.primaryRSI?.toFixed(1)})`) }, 'RSI extremes');
      }

      const settings = loadSettings();
      if (dispatchAlertsFn) await dispatchAlertsFn(rsiDataArray, settings);
      await runAutoTrader(rsiDataArray, settings);

      const prices = rsiDataArray.map(t => ({ symbol: t.symbol, price: t.price }));
      savePriceSnapshot(prices);
    }

    try {
      const marketData = await getMarketAnalysis('BTCUSDT');
      saveMarketSnapshot(marketData);
      logger.info('Market snapshot saved');
    } catch (e) {
      logger.warn({ err: e }, 'Market snapshot failed');
    }
  } catch (e) {
    logger.error({ err: e }, 'Snapshot collection error');
  }
}

module.exports = { getLastSnapshot, fetchAllRSI, fetchEnrichedRSI, runAutoTrader, collectSnapshot, AUTO_TRADER_USER };
