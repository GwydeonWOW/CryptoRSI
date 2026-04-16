const express = require('express');
const cors = require('cors');
const path = require('path');
const { calculateRSI, getRecommendation, calculateMultiTimeframeRSI } = require('./rsi');
const { fetchCandles, fetchCurrentPrice } = require('./api');
const { loadTokens, addToken, removeToken } = require('./config');
const { openPosition, closePosition, getOpenPositions, getHistory, getStats } = require('./trades');
const { getMarketAnalysis } = require('./futures');
const {
  saveRSISnapshot, getRSIHistory,
  saveMarketSnapshot, getMarketHistory,
  savePriceSnapshot, getPriceHistory,
  cleanupOldFiles, getDataDir
} = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve React build in production, fallback to old public/ for dev
const clientDist = path.join(__dirname, '..', 'client', 'dist');
const publicDir = path.join(__dirname, '..', 'public');
if (require('fs').existsSync(clientDist)) {
  app.use(express.static(clientDist));
} else {
  app.use(express.static(publicDir));
}

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

// ============================================================
// Historical Data Routes
// ============================================================

/**
 * GET /api/history/rsi/:symbol - RSI history for a token (last N days)
 */
app.get('/api/history/rsi/:symbol', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const history = getRSIHistory(req.params.symbol, days);
  res.json(history);
});

/**
 * GET /api/history/market - Market sentiment history (last N days)
 */
app.get('/api/history/market', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  res.json(getMarketHistory(days));
});

/**
 * GET /api/history/prices/:symbol - Price history for a token (last N days)
 */
app.get('/api/history/prices/:symbol', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  res.json(getPriceHistory(req.params.symbol, days));
});

// ============================================================
// SPA Fallback - serve index.html for all non-API routes
// ============================================================

app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  const indexPath = require('fs').existsSync(clientDist)
    ? path.join(clientDist, 'index.html')
    : path.join(__dirname, '..', 'public', 'index.html');

  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

// ============================================================
// Background Data Collection Scheduler
// Collects snapshots every 15 minutes to build historical data
// ============================================================

async function collectSnapshot() {
  console.log(`[${new Date().toISOString()}] Collecting data snapshot...`);

  try {
    // 1) RSI snapshot for all tracked tokens
    const tokens = loadTokens();
    const timeframes = ['1h', '4h', '1d'];

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
          const primaryTF = rsiData['1d']?.rsi !== null ? '1d'
            : rsiData['4h']?.rsi !== null ? '4h' : '1h';
          const primaryRSI = rsiData[primaryTF]?.rsi || null;
          const recommendation = primaryRSI !== null ? getRecommendation(primaryRSI) : null;

          return {
            symbol: token.symbol,
            name: token.name,
            price,
            primaryRSI,
            recommendation,
            timeframes: rsiData,
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
      console.log(`  RSI snapshot saved: ${rsiDataArray.length} tokens`);

      // Save price snapshot
      const prices = rsiDataArray.map(t => ({ symbol: t.symbol, price: t.price }));
      savePriceSnapshot(prices);
    }

    // 2) Market sentiment snapshot (BTC only to avoid rate limits)
    try {
      const marketData = await getMarketAnalysis('BTCUSDT');
      saveMarketSnapshot(marketData);
      console.log('  Market snapshot saved');
    } catch (e) {
      console.log(`  Market snapshot failed: ${e.message}`);
    }

  } catch (e) {
    console.error('Snapshot collection error:', e.message);
  }
}

// Schedule collection every 15 minutes
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

app.listen(PORT, () => {
  console.log(`CryptoRSI server running on http://localhost:${PORT}`);
  console.log(`Data directory: ${getDataDir()}`);

  // Collect initial snapshot after 30s (let server warm up)
  setTimeout(collectSnapshot, 30000);

  // Schedule periodic collection
  setInterval(collectSnapshot, SNAPSHOT_INTERVAL_MS);

  // Cleanup old files daily
  cleanupOldFiles(90);
  setInterval(() => cleanupOldFiles(90), 24 * 60 * 60 * 1000);
});
