const express = require('express');
const cors = require('cors');
const path = require('path');
const { calculateRSI, getRecommendation, calculateMultiTimeframeRSI } = require('./rsi');
const { fetchCandles, fetchCurrentPrice, calculateSMA } = require('./api');
const { loadTokens, addToken, removeToken } = require('./config');
const { openPosition, closePosition, getOpenPositions, getOpenPosition, hasOpenPosition, getHistory, getStats } = require('./trades');
const { getMarketAnalysis } = require('./futures');
const { checkAndNotify, startBotPolling, sendAlert: sendTelegramAlert } = require('./telegram');
const { checkAndNotifyDiscord, sendDiscordMessage, sendAlert: sendDiscordAlert } = require('./discord');
const { authMiddleware, adminMiddleware, generateToken, verifyPassword } = require('./auth');
const { loadSettings, saveSettings, getAlertConfig, setTokenAlerts, removeTokenAlerts, getMaskedSettings, getSimulationConfig, saveSimulationConfig } = require('./settings');
const cooldownStore = require('./cooldownStore');
const { ensureAdmin, listUsers, getUserByUsername, createUser, deleteUser, updateUser } = require('./users');
const {
  saveRSISnapshot, getRSIHistory,
  saveMarketSnapshot, getMarketHistory,
  savePriceSnapshot, getPriceHistory,
  cleanupOldFiles, getDataDir, writeJSON
} = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Shared last-snapshot store: reuse collectSnapshot data for HTTP endpoints
let lastSnapshot = null;
let lastSnapshotTime = 0;
const SNAPSHOT_SERVE_MS = 60 * 1000; // serve cached snapshot for up to 60s

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
 * POST /api/tokens - Add a token to track (admin only)
 */
app.post('/api/tokens', authMiddleware, adminMiddleware, (req, res) => {
  const { symbol, name } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  const result = addToken(symbol, name);
  res.json(result);
});

/**
 * DELETE /api/tokens/:symbol - Remove a tracked token (admin only)
 */
app.delete('/api/tokens/:symbol', authMiddleware, adminMiddleware, (req, res) => {
  const result = removeToken(req.params.symbol);
  res.json(result);
});

/**
 * GET /api/rsi/:symbol - Get RSI data for a token
 * Query params: timeframes (comma-separated, default: 1h,4h,1d)
 */
app.get('/api/rsi/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const symUpper = symbol.toUpperCase();

  // Serve from lastSnapshot if fresh
  if (lastSnapshot && Date.now() - lastSnapshotTime < SNAPSHOT_SERVE_MS) {
    const tokenData = lastSnapshot.find(t => t.symbol === symUpper && !t.error);
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
        updatedAt: new Date(lastSnapshotTime).toISOString(),
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
      if (r.closes.length > 0) {
        candlesByTimeframe[r.tf] = r.closes;
      }
    }

    const rsiData = calculateMultiTimeframeRSI(candlesByTimeframe, period);
    const { price, source: priceSource } = await fetchCurrentPrice(symUpper);

    // SMA 200 — fetchCandles('1h', 250) hits the same cache as fetchCandles('1h') above
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
      symbol: symUpper,
      price,
      priceSource,
      sma200,
      primaryRSI,
      primaryTimeframe: primaryTF,
      divergence: primaryDivergence,
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
  // Serve from lastSnapshot if fresh (avoids re-fetching all tokens)
  if (lastSnapshot && Date.now() - lastSnapshotTime < SNAPSHOT_SERVE_MS) {
    const enriched = lastSnapshot.map(t => {
      if (t.error) return t;
      const sparkline = (getPriceHistory(t.symbol, 1) || []).map(s => s.price);
      return { ...t, sparkline, updatedAt: new Date(lastSnapshotTime).toISOString() };
    });
    return res.json(enriched);
  }

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
          if (r.closes.length > 0) {
            candlesByTimeframe[r.tf] = r.closes;
          }
        }

        const rsiData = calculateMultiTimeframeRSI(candlesByTimeframe, period);
        const { price } = await fetchCurrentPrice(token.symbol);
        const sparkline = (getPriceHistory(token.symbol, 1) || []).map(s => s.price);

        // SMA 200 — fetchCandles('1h', 250) hits the same cache as fetchCandles('1h') above
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
          symbol: token.symbol,
          name: token.name,
          price,
          sparkline,
          sma200,
          primaryRSI,
          primaryTimeframe: primaryTF,
          divergence: primaryDivergence,
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
// BTC Price Widget (lightweight endpoint for header)
// ============================================================

app.get('/api/btc-price', async (req, res) => {
  try {
    const { price } = await fetchCurrentPrice('BTC');
    const sparkline = getPriceHistory('BTC', 1);
    res.json({ symbol: 'BTC', price, sparkline });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// Auth Routes
// ============================================================

/**
 * POST /api/auth/login - Login
 */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username y contrasena requeridos' });
  }

  const user = getUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
  }

  const token = generateToken(user);
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

/**
 * GET /api/auth/me - Get current user
 */
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = getUserByUsername(req.user.username);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { password: _, ...safeUser } = user;
  res.json(safeUser);
});

/**
 * PUT /api/auth/me - Update own profile
 */
app.put('/api/auth/me', authMiddleware, async (req, res) => {
  const result = await updateUser(req.user.id, req.body);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ============================================================
// User Management Routes (admin only)
// ============================================================

app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  res.json(listUsers());
});

app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  const { username, password, displayName, role } = req.body;
  const result = await createUser(username, password, displayName, role);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }
  const result = deleteUser(req.params.id);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ============================================================
// Trading Simulation Routes (require auth)
// ============================================================

/**
 * POST /api/trade/buy - Open a simulated position
 */
app.post('/api/trade/buy', authMiddleware, async (req, res) => {
  const { symbol, amount, timeframe } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

  try {
    const { price } = await fetchCurrentPrice(symbol);
    if (!price) return res.status(400).json({ error: 'No se pudo obtener el precio' });

    const rsiData = await _fetchEnrichedRSI(symbol);

    const result = openPosition(req.user.id, symbol, price, rsiData, parseFloat(amount) || 100, timeframe || '1d');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/trade/sell - Close a simulated position
 */
app.post('/api/trade/sell', authMiddleware, async (req, res) => {
  const { symbol, timeframe } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

  try {
    const { price } = await fetchCurrentPrice(symbol);
    if (!price) return res.status(400).json({ error: 'No se pudo obtener el precio' });

    const rsiData = await _fetchEnrichedRSI(symbol);

    const result = closePosition(req.user.id, symbol, price, rsiData, timeframe || '1d');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/trade/positions - Get open positions with live PnL
 */
app.get('/api/trade/positions', authMiddleware, async (req, res) => {
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

/**
 * GET /api/trade/history - Get closed trade history
 */
app.get('/api/trade/history', authMiddleware, (req, res) => {
  res.json(getHistory(req.user.id));
});

/**
 * GET /api/trade/stats - Get trading simulation stats
 */
app.get('/api/trade/stats', authMiddleware, (req, res) => {
  res.json(getStats(req.user.id));
});

/**
 * GET /api/trade/auto-stats - Auto-trader stats with per-token breakdown (admin)
 */
app.get('/api/trade/auto-stats', authMiddleware, adminMiddleware, async (req, res) => {
  const ADMIN_ID = 'admin_001';
  const history = getHistory(ADMIN_ID);
  const positions = getOpenPositions(ADMIN_ID);

  const overall = getStats(ADMIN_ID);

  const perToken = {};
  for (const trade of history) {
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

  res.json({ overall, perToken, history, positions: positionsWithPnL });
});

/**
 * GET /api/trade/auto-debug - Diagnostic: shows exactly what auto-trader sees
 */
app.get('/api/trade/auto-debug', authMiddleware, adminMiddleware, async (req, res) => {
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

        return {
          symbol: token.symbol,
          price,
          rsiByTimeframe: allTfRSI,
          openPositions,
          simActions,
        };
      } catch (e) {
        return { symbol: token.symbol, error: e.message };
      }
    })
  );

  res.json({
    simulation: {
      enabled: sim.enabled,
      amount: sim.amount,
      timeframes: sim.timeframes,
    },
    tokens: diagnostics.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
  });
});

/**
 * DELETE /api/trade/auto-reset - Reset auto-trader data (supreme admin only)
 */
app.delete('/api/trade/auto-reset', authMiddleware, adminMiddleware, (req, res) => {
  if (req.user.id !== 'admin_001' && req.user.username !== 'admin') {
    return res.status(403).json({ error: 'Solo el administrador principal puede resetear el simulador' });
  }
  const resetPath = path.join(getDataDir(), 'trades_admin_001.json');
  writeJSON(resetPath, { positions: [], history: [] });
  console.log('[AUTO-TRADE] Simulator reset by admin');
  res.json({ success: true });
});

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
// Settings Routes (admin only)
// ============================================================

/**
 * GET /api/settings - Get all settings (secrets masked)
 */
app.get('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getMaskedSettings());
});

/**
 * PUT /api/settings - Update settings (admin only)
 */
app.put('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
  const updated = saveSettings(req.body);
  res.json({ success: true, settings: updated });
});

/**
 * POST /api/settings/test/telegram - Send test Telegram message
 */
app.post('/api/settings/test/telegram', authMiddleware, adminMiddleware, async (req, res) => {
  const { chatId, botToken } = req.body;
  const currentSettings = loadSettings();
  const token = botToken || currentSettings.telegram.botToken;
  const chat = chatId || currentSettings.telegram.chatId;

  if (!token || !chat) {
    return res.status(400).json({ error: 'Configura Bot Token y Chat ID primero' });
  }

  const { sendTelegramMessage } = require('./telegram');
  const sent = await sendTelegramMessage('✅ Test desde CryptoRSI - Telegram configurado correctamente!', chat, token);
  if (sent) {
    res.json({ success: true, message: 'Mensaje de prueba enviado' });
  } else {
    res.status(500).json({ error: 'Error enviando mensaje. Verifica el token y chat ID.' });
  }
});

/**
 * POST /api/settings/test/discord - Send test Discord message
 */
app.post('/api/settings/test/discord', authMiddleware, adminMiddleware, async (req, res) => {
  const { webhookUrl } = req.body;
  const url = webhookUrl || loadSettings().discord.webhookUrl;

  if (!url) {
    return res.status(400).json({ error: 'Configura el Webhook URL primero' });
  }

  const sent = await sendDiscordMessage('✅ Test desde CryptoRSI - Discord configurado correctamente!', url);
  if (sent) {
    res.json({ success: true, message: 'Mensaje de prueba enviado' });
  } else {
    res.status(500).json({ error: 'Error enviando mensaje. Verifica el Webhook URL.' });
  }
});

/**
 * GET /api/settings/alerts/:symbol - Get merged alert config for a token
 */
app.get('/api/settings/alerts/:symbol', authMiddleware, adminMiddleware, (req, res) => {
  const config = getAlertConfig(req.params.symbol);
  res.json(config);
});

/**
 * PUT /api/settings/alerts/:symbol - Set per-token alert overrides
 */
app.put('/api/settings/alerts/:symbol', authMiddleware, adminMiddleware, (req, res) => {
  const result = setTokenAlerts(req.params.symbol, req.body);
  res.json({ success: true, settings: result });
});

/**
 * DELETE /api/settings/alerts/:symbol - Remove per-token overrides
 */
app.delete('/api/settings/alerts/:symbol', authMiddleware, adminMiddleware, (req, res) => {
  const result = removeTokenAlerts(req.params.symbol);
  res.json({ success: true, settings: result });
});

// ============================================================
// Simulation Config
// ============================================================

app.get('/api/settings/simulation', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getSimulationConfig());
});

app.put('/api/settings/simulation', authMiddleware, adminMiddleware, (req, res) => {
  const updated = saveSimulationConfig(req.body);
  res.json({ success: true, simulation: updated.simulation });
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

/**
 * Fetch RSI for all tracked tokens (used by /rsi Telegram command)
 */
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

async function _fetchEnrichedRSI(symbol) {
  const timeframes = ['15m', '1h', '4h', '1d'];
  const rsiData = { rsi15m: null, rsi1h: null, rsi4h: null, rsi1d: null, sma200: null, signalRSI: null };

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

    // SMA 200 — fetchCandles('1h', 250) hits the same cache as the 1h fetch above
    try {
      const { candles: hourlyCandles } = await fetchCandles(symbol, '1h', 250);
      rsiData.sma200 = calculateSMA(hourlyCandles.map(c => c.close), 200);
    } catch (e) { /* SMA optional */ }
  } catch (e) { /* RSI optional */ }

  return rsiData;
}

async function runAutoTrader(rsiDataArray, settings) {
  const sim = settings.simulation || {};
  if (!sim.enabled) {
    console.log('  [SIM] Skipped: simulation disabled');
    return;
  }

  const tfConfigs = sim.timeframes || {};
  const amount = sim.amount || 1000;
  const activeTFs = Object.entries(tfConfigs).filter(([, c]) => c.enabled);

  if (activeTFs.length === 0) {
    console.log('  [SIM] Skipped: no timeframes enabled');
    return;
  }

  console.log(`  [SIM] Checking ${rsiDataArray.length} tokens | Amount: $${amount} | TFs: ${activeTFs.map(([tf]) => tf).join(',')}`);

  for (const token of rsiDataArray) {
    if (token.error) continue;

    for (const [tf, config] of activeTFs) {
      let rsi = token.timeframes?.[tf]?.rsi;
      let rsiSource = 'batch';

      if (rsi === null || rsi === undefined) {
        const hasPos = hasOpenPosition(AUTO_TRADER_USER, token.symbol, tf);
        if (hasPos) {
          console.log(`  [SIM] RETRY: ${token.symbol} (${tf}) has open position but batch RSI is null — fetching directly...`);
          try {
            const { candles } = await fetchCandles(token.symbol, tf);
            const closes = candles.map(c => c.close);
            const rsiValues = calculateRSI(closes);
            rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
            if (rsi !== null) {
              rsiSource = 'retry';
              console.log(`  [SIM] RETRY OK: ${token.symbol} (${tf}) RSI=${rsi.toFixed(1)}`);
            } else {
              console.log(`  [SIM] RETRY FAILED: ${token.symbol} (${tf}) — could not calculate RSI from ${closes.length} candles`);
            }
          } catch (e) {
            console.log(`  [SIM] RETRY ERROR: ${token.symbol} (${tf}) ${e.message}`);
          }
        }
        if (rsi === null || rsi === undefined) continue;
      }

      const rsiData = {
        rsi15m: token.timeframes?.['15m']?.rsi ?? null,
        rsi1h: token.timeframes?.['1h']?.rsi ?? null,
        rsi4h: token.timeframes?.['4h']?.rsi ?? null,
        rsi1d: token.timeframes?.['1d']?.rsi ?? null,
        sma200: token.sma200 ?? null,
        signalRSI: rsi,
      };

      // Buy: RSI <= oversold, no position for (symbol, timeframe)
      if (rsi <= (config.rsiOversold || 30)) {
        if (!hasOpenPosition(AUTO_TRADER_USER, token.symbol, tf)) {
          const result = openPosition(AUTO_TRADER_USER, token.symbol, token.price, rsiData, amount, tf);
          if (result.success) {
            console.log(`  [SIM] BUY ${token.symbol} @ $${token.price?.toFixed(2)} | RSI ${rsi.toFixed(1)} (${tf}) | $${amount}`);
          }
        } else {
          console.log(`  [SIM] SKIP BUY ${token.symbol} (${tf}) | RSI ${rsi.toFixed(1)} <= ${config.rsiOversold || 30} but position open`);
        }
      }

      // Sell: RSI >= overbought, has position for (symbol, timeframe)
      if (rsi >= (config.rsiOverbought || 70)) {
        if (hasOpenPosition(AUTO_TRADER_USER, token.symbol, tf)) {
          const result = closePosition(AUTO_TRADER_USER, token.symbol, token.price, rsiData, tf);
          if (result.success) {
            const pnlStr = result.trade.pnl >= 0 ? `+$${result.trade.pnl.toFixed(2)}` : `-$${Math.abs(result.trade.pnl).toFixed(2)}`;
            console.log(`  [SIM] SELL ${token.symbol} @ $${token.price?.toFixed(2)} | RSI ${rsi.toFixed(1)} (${tf}) | ${pnlStr} (${result.trade.pnlPct.toFixed(1)}%)${rsiSource === 'retry' ? ' [RETRY]' : ''}`);
          }
        } else {
          console.log(`  [SIM] SKIP SELL ${token.symbol} (${tf}) | RSI ${rsi.toFixed(1)} >= ${config.rsiOverbought || 70} but no position`);
        }
      }
    }
  }
}

// ============================================================
// Centralized alert dispatcher — single cooldown for both channels
// ============================================================

function buildAlertQueue(rsiDataArray, settings) {
  const alertGeneric = settings.alerts?.generic || {};
  const tokenAlerts = settings.alerts?.tokens || {};
  const cooldownMs = (alertGeneric.cooldownMinutes || 240) * 60 * 1000;
  const now = Date.now();

  const queue = [];

  for (const token of rsiDataArray) {
    if (!token.primaryRSI || !token.recommendation) continue;

    const { symbol } = token;
    const divergence = token.divergence;
    const alertConfig = { ...alertGeneric, ...(tokenAlerts[symbol] || {}) };
    const alertTf = alertConfig.alertTimeframe || '1d';
    const alertRSI = token.timeframes?.[alertTf]?.rsi || token.primaryRSI;

    // Bullish divergence
    if (alertConfig.divergenceBullish && divergence?.bullish && alertRSI <= 40) {
      const key = `bull:${symbol}`;
      const lastSent = cooldownStore.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {
        queue.push({ type: 'bull', key, token, alertRSI, alertTf, alertConfig });
      }
    }

    // Bearish divergence
    if (alertConfig.divergenceBearish && divergence?.bearish && alertRSI >= 60) {
      const key = `bear:${symbol}`;
      const lastSent = cooldownStore.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {
        queue.push({ type: 'bear', key, token, alertRSI, alertTf, alertConfig });
      }
    }

    // Oversold
    if (alertRSI <= (alertConfig.rsiOversold || 30)) {
      const key = `buy:${symbol}`;
      const lastSent = cooldownStore.get(key);
      const blocked = lastSent && now - lastSent < cooldownMs;
      console.log(`  [ALERT] OVERSOLD ${symbol} | RSI ${alertRSI.toFixed(1)} (${alertTf}) | blocked=${blocked}${blocked ? ` (${Math.round((cooldownMs - (now - lastSent)) / 60000)}min left)` : ''}`);
      if (!blocked) {
        queue.push({ type: 'oversold', key, token, alertRSI, alertTf, alertConfig });
      }
    }

    // Overbought
    if (alertRSI >= (alertConfig.rsiOverbought || 70)) {
      const key = `sell:${symbol}`;
      const lastSent = cooldownStore.get(key);
      const blocked = lastSent && now - lastSent < cooldownMs;
      console.log(`  [ALERT] OVERBOUGHT ${symbol} | RSI ${alertRSI.toFixed(1)} (${alertTf}) | blocked=${blocked}${blocked ? ` (${Math.round((cooldownMs - (now - lastSent)) / 60000)}min left)` : ''}`);
      if (!blocked) {
        queue.push({ type: 'overbought', key, token, alertRSI, alertTf, alertConfig });
      }
    }
  }

  return queue;
}

async function dispatchAlerts(rsiDataArray, settings) {
  const tg = settings.telegram || {};
  const dc = settings.discord || {};
  const tgWebEnabled = tg.enabled && tg.botToken && tg.chatId;
  const tgBackupToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgBackupChatId = process.env.TELEGRAM_CHAT_ID;
  const tgUseBackup = !!(tgBackupToken && tgBackupChatId);
  const dcEnabled = dc.enabled && dc.webhookUrl;

  if (!tgWebEnabled && !tgUseBackup && !dcEnabled) {
    console.log('  [ALERT] SKIPPED: no channel configured');
    return;
  }

  const queue = buildAlertQueue(rsiDataArray, settings);

  if (queue.length === 0) return;

  console.log(`  [ALERT] Dispatching ${queue.length} alerts (TG: ${tgWebEnabled || tgUseBackup}, DC: ${dcEnabled})`);

  for (const alert of queue) {
    let anySent = false;
    const { type, key, token, alertRSI, alertTf, alertConfig } = alert;

    // Telegram
    if (tgWebEnabled) {
      const sent = await sendTelegramAlert(type, token, alertRSI, alertTf, alertConfig, tg.chatId, tg.botToken);
      if (sent) anySent = true;
    }
    if (tgUseBackup) {
      const sent = await sendTelegramAlert(type, token, alertRSI, alertTf, alertConfig, tgBackupChatId, tgBackupToken);
      if (sent) anySent = true;
    }

    // Discord
    if (dcEnabled) {
      const sent = await sendDiscordAlert(type, token, alertRSI, alertTf, alertConfig, dc.webhookUrl);
      if (sent) anySent = true;
    }

    // Set global cooldown if at least one channel succeeded
    if (anySent) {
      cooldownStore.set(key, Date.now());
      console.log(`  [ALERT] SENT ${type} ${token.symbol} | RSI ${alertRSI.toFixed(1)} (${alertTf})`);
    } else {
      console.log(`  [ALERT] FAILED ${type} ${token.symbol} | all channels failed — cooldown NOT set (will retry next tick)`);
    }
  }
}

async function collectSnapshot() {
  console.log(`[${new Date().toISOString()}] Collecting data snapshot...`);

  try {
    // 1) RSI snapshot for all tracked tokens
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

          // SMA 200 — fetchCandles('1h', 250) hits the same cache as the 1h fetch above
          let sma200 = null;
          try {
            const { candles: hourlyCandles } = await fetchCandles(token.symbol, '1h', 250);
            sma200 = calculateSMA(hourlyCandles.map(c => c.close), 200);
          } catch (e) { /* SMA unavailable */ }

          return {
            symbol: token.symbol,
            name: token.name,
            price,
            sma200,
            primaryRSI,
            primaryTimeframe: primaryTF,
            divergence: primaryDivergence,
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

      // Store for HTTP endpoints to reuse
      lastSnapshot = rsiDataArray;
      lastSnapshotTime = Date.now();

      console.log(`  RSI snapshot saved: ${rsiDataArray.length} tokens`);

      // Log RSI availability per token/timeframe for diagnostics
      const nullTFs = rsiDataArray
        .map(t => {
          const missing = ['15m', '1h', '4h', '1d'].filter(tf => t.timeframes?.[tf]?.rsi == null);
          return missing.length > 0 ? `${t.symbol}(null: ${missing.join(',')})` : null;
        })
        .filter(Boolean);
      if (nullTFs.length > 0) console.log(`  [RSI-DATA] Null timeframes: ${nullTFs.join(' | ')}`);

      // Check RSI signals and send Telegram notifications
      const divergences = rsiDataArray.filter(t => t.divergence?.bullish || t.divergence?.bearish);
      if (divergences.length > 0) {
        console.log(`  Divergences detected: ${divergences.map(t => `${t.symbol}(${t.divergence.bullish ? 'BULL' : 'BEAR'})`).join(', ')}`);
      }
      const extremes = rsiDataArray.filter(t => t.primaryRSI !== null && (t.primaryRSI <= 30 || t.primaryRSI >= 70));
      if (extremes.length > 0) {
        console.log(`  RSI extremes: ${extremes.map(t => `${t.symbol}(${t.primaryRSI?.toFixed(1)})`).join(', ')}`);
      }
      // Send notifications via centralized dispatcher (single cooldown for both channels)
      const settings = loadSettings();
      await dispatchAlerts(rsiDataArray, settings);

      // Auto-trader: buy on oversold, sell on overbought
      await runAutoTrader(rsiDataArray, settings);

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

app.listen(PORT, async () => {
  console.log(`CryptoRSI server running on http://localhost:${PORT}`);
  console.log(`Data directory: ${getDataDir()}`);

  // Ensure default admin user exists
  await ensureAdmin();

  // Start Telegram bot polling for /rsi command
  startBotPolling(fetchAllRSI, loadSettings);

  // Collect initial snapshot after 30s (let server warm up)
  setTimeout(collectSnapshot, 30000);

  // Schedule periodic collection
  setInterval(collectSnapshot, SNAPSHOT_INTERVAL_MS);

  // Cleanup old files daily
  cleanupOldFiles(90);
  setInterval(() => cleanupOldFiles(90), 24 * 60 * 60 * 1000);
});
