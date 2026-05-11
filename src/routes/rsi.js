/**
 * RSI Data Routes — Multi-timeframe RSI data, BTC price widget
 */

const { Router } = require('express');
const { calculateRSI, getRecommendation, calculateMultiTimeframeRSI } = require('../rsi');
const { fetchCandles, fetchCurrentPrice, calculateSMA } = require('../api');
const { getLastSnapshot, fetchEnrichedRSI, runAutoTrader } = require('../services/snapshot');
const { dispatchAlerts } = require('../services/alerts');
const { loadSettings } = require('../settings');
const { getPriceHistory } = require('../storage');
const logger = require('../logger');

const router = Router();

router.get('/rsi/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const symUpper = symbol.toUpperCase();

  const cached = getLastSnapshot();
  if (cached) {
    const tokenData = cached.data.find(t => t.symbol === symUpper && !t.error);
    if (tokenData) {
      const rsiData = tokenData.timeframes || {};
      const primaryDivergence = tokenData.divergence;
      const overallRecommendation = getRecommendation(tokenData.primaryRSI || 50, primaryDivergence);
      let overallAction = 'wait';
      for (const [, data] of Object.entries(rsiData)) {
        if (data.divergence?.bullish) overallAction = 'buy';
        if (data.divergence?.bearish) overallAction = 'sell';
      }
      return res.json({
        ...tokenData,
        priceSource: 'cache',
        overall: { action: overallAction, ...overallRecommendation },
        period: 14,
        updatedAt: new Date(cached.time).toISOString(),
      });
    }
  }

  const timeframes = (req.query.timeframes || '15m,1h,4h,1d').split(',');
  const period = parseInt(req.query.period) || 14;

  try {
    const candlesByTimeframe = {};
    const fetches = timeframes.map(async tf => {
      try {
        const { candles } = await fetchCandles(symUpper, tf);
        return { tf, closes: candles.map(c => c.close) };
      } catch (e) {
        return { tf, closes: [], error: e.message };
      }
    });

    const results = await Promise.all(fetches);
    for (const r of results) {
      if (r.closes.length > 0) candlesByTimeframe[r.tf] = r.closes;
    }

    const rsiData = calculateMultiTimeframeRSI(candlesByTimeframe, period);
    const { price, source: priceSource } = await fetchCurrentPrice(symUpper);

    let sma200 = null;
    try {
      const { candles: hourlyCandles } = await fetchCandles(symUpper, '1h', 250);
      sma200 = calculateSMA(hourlyCandles.map(c => c.close), 200);
    } catch (e) { /* SMA unavailable */ }

    const primaryTF = rsiData['15m']?.rsi !== null ? '15m'
      : rsiData['1h']?.rsi !== null ? '1h'
      : rsiData['4h']?.rsi !== null ? '4h' : '1d';
    const primaryRSI = rsiData[primaryTF]?.rsi || null;
    const primaryDivergence = rsiData[primaryTF]?.divergence || null;

    let overallAction = 'wait';
    for (const [, data] of Object.entries(rsiData)) {
      if (data.divergence?.bullish) overallAction = 'buy';
      if (data.divergence?.bearish) overallAction = 'sell';
    }

    const overallRecommendation = getRecommendation(primaryRSI || 50, primaryDivergence);

    res.json({
      symbol: symUpper, price, priceSource, sma200,
      primaryRSI, primaryTimeframe: primaryTF,
      divergence: primaryDivergence, timeframes: rsiData,
      overall: { action: overallAction, ...overallRecommendation },
      period, updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/rsi', async (req, res) => {
  const cached = getLastSnapshot();
  if (cached) {
    const enriched = cached.data.map(t => {
      if (t.error) return t;
      const sparkline = (getPriceHistory(t.symbol, 1) || []).map(s => s.price);
      return { ...t, sparkline, updatedAt: new Date(cached.time).toISOString() };
    });
    return res.json(enriched);
  }

  // No cached data — fetch fresh and trigger alerts + auto-trader
  const { loadTokens } = require('../config');
  const tokens = loadTokens();
  const timeframes = (req.query.timeframes || '15m,1h,4h,1d').split(',');
  const period = parseInt(req.query.period) || 14;

  const results = await Promise.allSettled(
    tokens.map(async (token) => {
      try {
        const candlesByTimeframe = {};
        const fetches = timeframes.map(async tf => {
          try {
            const { candles } = await fetchCandles(token.symbol, tf);
            return { tf, closes: candles.map(c => c.close) };
          } catch (e) {
            return { tf, closes: [], error: e.message };
          }
        });

        const fetchResults = await Promise.all(fetches);
        for (const r of fetchResults) {
          if (r.closes.length > 0) candlesByTimeframe[r.tf] = r.closes;
        }

        const rsiData = calculateMultiTimeframeRSI(candlesByTimeframe, period);
        const { price } = await fetchCurrentPrice(token.symbol);
        const sparkline = (getPriceHistory(token.symbol, 1) || []).map(s => s.price);

        let sma200 = null;
        try {
          const { candles: hourlyCandles } = await fetchCandles(token.symbol, '1h', 250);
          sma200 = calculateSMA(hourlyCandles.map(c => c.close), 200);
        } catch (e) { /* SMA unavailable */ }

        const primaryTF = rsiData['15m']?.rsi !== null ? '15m'
          : rsiData['1h']?.rsi !== null ? '1h'
          : rsiData['4h']?.rsi !== null ? '4h' : '1d';
        const primaryRSI = rsiData[primaryTF]?.rsi || null;
        const primaryDivergence = rsiData[primaryTF]?.divergence || null;
        const recommendation = primaryRSI !== null ? getRecommendation(primaryRSI, primaryDivergence) : null;

        return {
          symbol: token.symbol, name: token.name, price, sparkline, sma200,
          primaryRSI, primaryTimeframe: primaryTF,
          divergence: primaryDivergence, recommendation,
          timeframes: rsiData, updatedAt: new Date().toISOString()
        };
      } catch (e) {
        return { symbol: token.symbol, name: token.name, error: e.message };
      }
    })
  );

  const rsiDataArray = results
    .filter(r => r.status === 'fulfilled' && !r.value.error)
    .map(r => r.value);

  // Fire alerts + auto-trader with the same fresh data (non-blocking)
  if (rsiDataArray.length > 0) {
    const settings = loadSettings();
    dispatchAlerts(rsiDataArray, settings).catch(e => logger.error({ err: e }, 'Alert dispatch failed'));
    runAutoTrader(rsiDataArray, settings).catch(e => logger.error({ err: e }, 'Auto-trader failed'));
  }

  res.json(results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message }));
});

router.get('/btc-price', async (req, res) => {
  try {
    const { price } = await fetchCurrentPrice('BTC');
    const sparkline = getPriceHistory('BTC', 1);
    res.json({ symbol: 'BTC', price, sparkline });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
