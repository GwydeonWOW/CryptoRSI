/**
 * CryptoRSI Server — v2 (modular architecture)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');

const logger = require('./logger');
const { closeDb, getDataDir } = require('./db');
const { startBotPolling } = require('./telegram');
const { ensureAdmin } = require('./users');
const { loadSettings } = require('./settings');
const { cleanupOldData } = require('./storage');
const { collectSnapshot, fetchAllRSI, getLastSnapshot } = require('./services/snapshot');
const { dispatchAlerts } = require('./services/alerts');

// Route modules
const authRoutes = require('./routes/auth');
const tokenRoutes = require('./routes/tokens');
const rsiRoutes = require('./routes/rsi');
const tradeRoutes = require('./routes/trades');
const settingsRoutes = require('./routes/settings');
const userRoutes = require('./routes/users');
const marketRoutes = require('./routes/market');
const historyRoutes = require('./routes/history');
const adminRoutes = require('./routes/admin');
const backtestRoutes = require('./routes/backtest');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

// Serve React build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
} else {
  app.use(express.static(publicDir));
}

// ============================================================
// Health Check
// ============================================================

app.get('/api/health', (req, res) => {
  const snapshot = getLastSnapshot();
  const uptime = process.uptime();
  const status = snapshot ? 'ok' : uptime > 1800 ? 'degraded' : 'starting';

  res.status(status === 'degraded' ? 503 : 200).json({
    status,
    uptime: Math.floor(uptime),
    timestamp: new Date().toISOString(),
    lastSnapshot: snapshot ? new Date(snapshot.time).toISOString() : null,
    version: '2.0.0',
  });
});

// ============================================================
// Mount API Routes
// ============================================================

app.use('/api', authRoutes);
app.use('/api', tokenRoutes);
app.use('/api', rsiRoutes);
app.use('/api', tradeRoutes);
app.use('/api', settingsRoutes);
app.use('/api', userRoutes);
app.use('/api', marketRoutes);
app.use('/api', historyRoutes);
app.use('/api', adminRoutes);
app.use('/api', backtestRoutes);

// ============================================================
// SPA Fallback
// ============================================================

app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const indexPath = fs.existsSync(clientDist)
    ? path.join(clientDist, 'index.html')
    : path.join(publicDir, 'index.html');

  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

// ============================================================
// Server Start + Graceful Shutdown
// ============================================================

const SNAPSHOT_INTERVAL_MS = (parseInt(process.env.SNAPSHOT_INTERVAL_MIN) || 5) * 60 * 1000;
const startTime = Date.now();

const server = app.listen(PORT, async () => {
  logger.info({ port: PORT, dataDir: getDataDir(), snapshotInterval: `${SNAPSHOT_INTERVAL_MS / 60000}min` }, 'CryptoRSI server started');

  await ensureAdmin();
  startBotPolling(fetchAllRSI, loadSettings);

  setTimeout(() => collectSnapshot(dispatchAlerts), 30000);
  setInterval(() => collectSnapshot(dispatchAlerts), SNAPSHOT_INTERVAL_MS);

  cleanupOldData(90);
  setInterval(() => cleanupOldData(90), 24 * 60 * 60 * 1000);
});

function gracefulShutdown(signal) {
  logger.info({ signal }, 'Shutting down gracefully...');
  server.close(() => {
    closeDb();
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
