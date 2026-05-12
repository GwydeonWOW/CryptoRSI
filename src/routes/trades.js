/**
 * Trading Simulation Routes
 */

const { Router } = require('express');
const { authMiddleware, adminMiddleware } = require('../auth');
const { openPosition, closePosition, closeAllPositions, getOpenPositions, getOpenPosition, hasOpenPosition, getHistory, getPaginatedHistory, getStats } = require('../trades');
const { fetchCurrentPrice } = require('../api');
const { fetchEnrichedRSI, AUTO_TRADER_USER } = require('../services/snapshot');
const { getDb } = require('../db');
const { loadTokens } = require('../config');
const { calculateRSI, calculateMultiTimeframeRSI } = require('../rsi');
const { fetchCandles } = require('../api');
const { loadSettings } = require('../settings');
const { validateTrade, handleValidationErrors } = require('../middleware/validate');

const router = Router();

router.post('/trade/buy', authMiddleware, validateTrade, handleValidationErrors, async (req, res) => {
  const { symbol, amount, timeframe } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

  try {
    const { price } = await fetchCurrentPrice(symbol);
    if (!price) return res.status(400).json({ error: 'No se pudo obtener el precio' });

    const rsiData = await fetchEnrichedRSI(symbol);
    const settings = loadSettings();
    const feePercent = settings.simulation?.feePercent || 0;
    const result = openPosition(req.user.id, symbol, price, rsiData, parseFloat(amount) || 100, timeframe || '1d', feePercent);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trade/sell', authMiddleware, validateTrade, handleValidationErrors, async (req, res) => {
  const { symbol, timeframe } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

  try {
    const { price } = await fetchCurrentPrice(symbol);
    if (!price) return res.status(400).json({ error: 'No se pudo obtener el precio' });

    const rsiData = await fetchEnrichedRSI(symbol);
    const settings = loadSettings();
    const feePercent = settings.simulation?.feePercent || 0;
    const result = closePosition(req.user.id, symbol, price, rsiData, timeframe || '1d', feePercent);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/trade/positions', authMiddleware, async (req, res) => {
  const positions = getOpenPositions(req.user.id);
  const enriched = await Promise.all(positions.map(async (pos) => {
    try {
      const { price } = await fetchCurrentPrice(pos.symbol);
      const currentValue = pos.quantity * price;
      const pnl = currentValue - pos.amount;
      const pnlPct = (pnl / pos.amount) * 100;
      return { ...pos, currentPrice: price, currentValue, pnl, pnlPct };
    } catch (e) {
      return { ...pos, currentPrice: null, pnl: 0, pnlPct: 0, error: e.message };
    }
  }));
  res.json(enriched);
});

router.get('/trade/history', authMiddleware, (req, res) => {
  const { page, limit, symbol, timeframe, from, to, sort, order } = req.query;
  const result = getPaginatedHistory(req.user.id, { page, limit, symbol, timeframe, from, to, sort, order });
  res.json(result);
});

router.get('/trade/history/all', authMiddleware, (req, res) => {
  res.json(getHistory(req.user.id));
});

router.get('/trade/stats', authMiddleware, (req, res) => {
  const { from, to } = req.query;
  res.json(getStats(req.user.id, { from, to }));
});

router.get('/trade/auto-stats', authMiddleware, async (req, res) => {
  const { from, to, page, limit, symbol, timeframe } = req.query;
  const opts = { from, to };
  const usePagination = page || limit;

  const allHistory = getHistory(AUTO_TRADER_USER);
  const positions = getOpenPositions(AUTO_TRADER_USER);
  const overall = getStats(AUTO_TRADER_USER, opts);

  const perToken = {};
  for (const trade of allHistory) {
    if (!perToken[trade.symbol]) perToken[trade.symbol] = { trades: 0, wins: 0, pnl: 0, pnlPct: [] };
    perToken[trade.symbol].trades++;
    if (trade.pnl > 0) perToken[trade.symbol].wins++;
    perToken[trade.symbol].pnl += trade.pnl;
    perToken[trade.symbol].pnlPct.push(trade.pnlPct);
  }

  const positionsWithPnL = await Promise.all(positions.map(async pos => {
    try {
      const { price } = await fetchCurrentPrice(pos.symbol);
      const currentValue = pos.quantity * price;
      const pnl = currentValue - pos.amount;
      const pnlPct = (pnl / pos.amount) * 100;
      return { ...pos, currentPrice: price, currentValue, pnl, pnlPct };
    } catch (e) {
      return { ...pos, currentPrice: null, pnl: 0, pnlPct: 0, error: e.message };
    }
  }));

  if (usePagination) {
    const result = getPaginatedHistory(AUTO_TRADER_USER, { page, limit, symbol, timeframe, from, to });
    res.json({ overall, perToken, history: result.trades, positions: positionsWithPnL, pagination: result.pagination, filterStats: result.stats });
  } else {
    res.json({ overall, perToken, history: allHistory, positions: positionsWithPnL });
  }
});

router.get('/trade/auto-debug', authMiddleware, adminMiddleware, async (req, res) => {
  const settings = loadSettings();
  const sim = settings.simulation || {};
  const tokens = loadTokens();
  const timeframes = ['15m', '1h', '4h', '1d'];

  const diagnostics = await Promise.allSettled(
    tokens.map(async (token) => {
      try {
        const candlesByTimeframe = {};
        const fetches = timeframes.map(async tf => {
          try {
            const { candles } = await fetchCandles(token.symbol, tf);
            return { tf, closes: candles.map(c => c.close) };
          } catch (e) { return { tf, closes: [] }; }
        });
        const results = await Promise.all(fetches);
        for (const r of results) {
          if (r.closes.length > 0) candlesByTimeframe[r.tf] = r.closes;
        }
        const rsiData = calculateMultiTimeframeRSI(candlesByTimeframe, 14);
        const { price } = await fetchCurrentPrice(token.symbol);

        const allTfRSI = {};
        for (const tf of timeframes) {
          allTfRSI[tf] = rsiData[tf]?.rsi ?? null;
        }

        const openPositions = {};
        for (const tf of timeframes) {
          openPositions[tf] = hasOpenPosition(AUTO_TRADER_USER, token.symbol, tf);
        }

        const simActions = {};
        for (const [tf, config] of Object.entries(sim.timeframes || {})) {
          if (!config.enabled) { simActions[tf] = 'disabled'; continue; }
          const rsi = allTfRSI[tf];
          if (rsi === null) { simActions[tf] = 'no_data'; continue; }
          if (rsi <= (config.rsiOversold || 30) && !openPositions[tf]) simActions[tf] = 'BUY';
          else if (rsi >= (config.rsiOverbought || 70) && openPositions[tf]) simActions[tf] = 'SELL';
          else simActions[tf] = 'hold';
        }

        return { symbol: token.symbol, price, rsiByTimeframe: allTfRSI, openPositions, simActions };
      } catch (e) {
        return { symbol: token.symbol, error: e.message };
      }
    })
  );

  res.json({
    simulation: { enabled: sim.enabled, amount: sim.amount, timeframes: sim.timeframes },
    tokens: diagnostics.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
  });
});

router.delete('/trade/auto-reset', authMiddleware, adminMiddleware, (req, res) => {
  if (req.user.id !== 'admin_001' && req.user.username !== 'admin') {
    return res.status(403).json({ error: 'Solo el administrador principal puede resetear el simulador' });
  }
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM positions WHERE user_id = ?').run('admin_001');
    db.prepare('DELETE FROM history WHERE user_id = ?').run('admin_001');
  })();
  console.log('[AUTO-TRADE] Simulator reset by admin'); // TODO: replace with logger
  res.json({ success: true });
});

module.exports = router;
