const express = require('express');
const cors = require('cors');
const path = require('path');
const { calculateRSI, getRecommendation, calculateMultiTimeframeRSI } = require('./rsi');
const { fetchCandles, fetchCurrentPrice } = require('./api');
const { loadTokens, addToken, removeToken } = require('./config');
const { openPosition, closePosition, getOpenPositions, getHistory, getStats } = require('./trades');
const { getMarketAnalysis } = require('./futures');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// API Routes
// ============================================================

/**
 * GET /api/tokens - List tracked tokens
 */
app.get('/api/tokens', (req, res) => {
  res.json(loadTokens());
});

/**
 * POST /api/tokens - Add a token to track
 */
app.post('/api/tokens', (req, res) => {
  const { symbol, name } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  const result = addToken(symbol, name);
  res.json(result);
});

/**
 * DELETE /api/tokens/:symbol - Remove a tracked token
 */
app.delete('/api/tokens/:symbol', (req, res) => {
  const result = removeToken(req.params.symbol);
  res.json(result);
});

/**
 * GET /api/rsi/:symbol - Get RSI data for a token
 * Query params: timeframes (comma-separated, default: 1h,4h,1d)
 */
app.get('/api/rsi/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const timeframes = (req.query.timeframes || '1h,4h,1d').split(',');
  const period = parseInt(req.query.period) || 14;

  try {
    const candlesByTimeframe = {};

    // Fetch candles for all timeframes in parallel
    const fetches = timeframes.map(async tf => {
      try {
        const { candles } = await fetchCandles(symbol, tf);
        return { tf, closes: candles.map(c => c.close) };
      } catch (e) {
        return { tf, closes: [], error: e.message };
      }
    });

    const results = await Promise.all(fetches);
    for (const r of results) {
      if (r.closes.length > 0) {
        candlesByTimeframe[r.tf] = r.closes;
      }
    }

    // Calculate RSI for all timeframes
    const rsiData = calculateMultiTimeframeRSI(candlesByTimeframe, period);

    // Get current price
    const { price, source: priceSource } = await fetchCurrentPrice(symbol);

    // Determine overall recommendation (weighted by timeframe importance)
    const weights = { '1d': 3, '4h': 2, '1h': 1 };
    let buyScore = 0, sellScore = 0, totalWeight = 0;

    for (const [tf, data] of Object.entries(rsiData)) {
      if (data.rsi !== null) {
        const w = weights[tf] || 1;
        totalWeight += w;
        if (data.rsi <= 30) buyScore += w;
        else if (data.rsi >= 70) sellScore += w;
      }
    }

    let overallAction = 'wait';
    if (totalWeight > 0) {
      if (buyScore / totalWeight >= 0.5) overallAction = 'buy';
      else if (sellScore / totalWeight >= 0.5) overallAction = 'sell';
    }

    const overallRecommendation = getRecommendation(
      Object.values(rsiData).find(d => d.rsi !== null)?.rsi || 50
    );

    res.json({
      symbol: symbol.toUpperCase(),
      price,
      priceSource,
      timeframes: rsiData,
      overall: {
        action: overallAction,
        ...overallRecommendation
      },
      period,
      updatedAt: new Date().toISOString()
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/rsi - Get RSI for ALL tracked tokens
 */
app.get('/api/rsi', async (req, res) => {
  const tokens = loadTokens();
  const timeframes = (req.query.timeframes || '1h,4h,1d').split(',');
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
          if (r.closes.length > 0) {
            candlesByTimeframe[r.tf] = r.closes;
          }
        }

        const rsiData = calculateMultiTimeframeRSI(candlesByTimeframe, period);
        const { price } = await fetchCurrentPrice(token.symbol);

        // Get primary RSI (1d preferred)
        const primaryTF = rsiData['1d']?.rsi !== null ? '1d'
          : rsiData['4h']?.rsi !== null ? '4h' : '1h';
        const primaryRSI = rsiData[primaryTF]?.rsi || null;
        const recommendation = primaryRSI !== null ? getRecommendation(primaryRSI) : null;

        return {
          symbol: token.symbol,
          name: token.name,
          price,
          primaryRSI,
          primaryTimeframe: primaryTF,
          recommendation,
          timeframes: rsiData,
          updatedAt: new Date().toISOString()
        };
      } catch (e) {
        return {
          symbol: token.symbol,
          name: token.name,
          error: e.message
        };
      }
    })
  );

  res.json(results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message }));
});

// ============================================================
// Trading Simulation Routes
// ============================================================

/**
 * POST /api/trade/buy - Open a simulated position
 */
app.post('/api/trade/buy', async (req, res) => {
  const { symbol, amount } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

  try {
    const { price } = await fetchCurrentPrice(symbol);
    if (!price) return res.status(400).json({ error: 'No se pudo obtener el precio' });

    // Get current RSI
    let rsiAtOpen = null;
    try {
      const { candles } = await fetchCandles(symbol, '1d');
      const closes = candles.map(c => c.close);
      const rsiValues = calculateRSI(closes, 14);
      rsiAtOpen = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
    } catch (e) { /* RSI optional */ }

    const result = openPosition(symbol, price, rsiAtOpen, parseFloat(amount) || 100);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/trade/sell - Close a simulated position
 */
app.post('/api/trade/sell', async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

  try {
    const { price } = await fetchCurrentPrice(symbol);
    if (!price) return res.status(400).json({ error: 'No se pudo obtener el precio' });

    let rsiAtClose = null;
    try {
      const { candles } = await fetchCandles(symbol, '1d');
      const closes = candles.map(c => c.close);
      const rsiValues = calculateRSI(closes, 14);
      rsiAtClose = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
    } catch (e) { /* RSI optional */ }

    const result = closePosition(symbol, price, rsiAtClose);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/trade/positions - Get all open positions with live PnL
 */
app.get('/api/trade/positions', async (req, res) => {
  const positions = getOpenPositions();

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

/**
 * GET /api/trade/history - Get closed trade history
 */
app.get('/api/trade/history', (req, res) => {
  res.json(getHistory());
});

/**
 * GET /api/trade/stats - Get trading simulation stats
 */
app.get('/api/trade/stats', (req, res) => {
  res.json(getStats());
});

// ============================================================
// Market Analysis (Futures / Heatmap Interpretation)
// ============================================================

/**
 * GET /api/market/:symbol - Comprehensive market analysis for a symbol
 * Includes funding rate, OI, long/short ratio, liquidation zones, sentiment
 */
app.get('/api/market/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const futuresSymbol = symbol.toUpperCase().includes('USDT')
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  try {
    const analysis = await getMarketAnalysis(futuresSymbol);
    res.json(analysis);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`CryptoRSI server running on http://localhost:${PORT}`);
});
