/**
 * Admin-only endpoints: backup, rate limit management
 */

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { authMiddleware, ownerMiddleware } = require('../auth');
const { getDb, getDataDir } = require('../db');
const { resetRateLimit, getRateLimitedIPs } = require('../middleware/rateLimit');
const logger = require('../logger');

const router = Router();

router.get('/admin/backup', authMiddleware, ownerMiddleware, (req, res) => {
  try {
    const db = getDb();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(getDataDir(), `backup_${timestamp}.db`);

    db.backup(backupPath)
      .then(() => {
        const filename = `cryptorsi_backup_${timestamp}.db`;
        res.download(backupPath, filename, () => {
          try { fs.unlinkSync(backupPath); } catch {}
        });
      })
      .catch(err => {
        logger.error({ err }, 'Backup failed');
        res.status(500).json({ error: 'Error creando backup: ' + err.message });
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/rate-limits', authMiddleware, ownerMiddleware, (req, res) => {
  const limited = getRateLimitedIPs();
  res.json({ rateLimits: limited });
});

router.delete('/admin/rate-limits/:key', authMiddleware, ownerMiddleware, (req, res) => {
  const key = decodeURIComponent(req.params.key);
  // Extract IP from the key format "windowMs:ip"
  const ip = key.includes(':') ? key.split(':').slice(1).join(':') : key;
  const ok = resetRateLimit(ip);
  if (ok) {
    logger.info({ ip }, 'Rate limit cleared by owner');
    res.json({ success: true, message: `Rate limit cleared for ${ip}` });
  } else {
    res.status(500).json({ error: 'Could not clear rate limit' });
  }
});

router.delete('/admin/rate-limits', authMiddleware, ownerMiddleware, (req, res) => {
  // Clear all rate limits
  const limited = getRateLimitedIPs();
  let cleared = 0;
  for (const entry of limited) {
    const ip = entry.key.includes(':') ? entry.key.split(':').slice(1).join(':') : entry.key;
    if (resetRateLimit(ip)) cleared++;
  }
  logger.info({ cleared }, 'All rate limits cleared by owner');
  res.json({ success: true, cleared });
});

module.exports = router;
