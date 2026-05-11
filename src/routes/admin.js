/**
 * Admin-only endpoints: backup, restore
 */

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { authMiddleware, adminMiddleware } = require('../auth');
const { getDb, closeDb, getDataDir } = require('../db');
const logger = require('../logger');

const router = Router();

router.get('/admin/backup', authMiddleware, adminMiddleware, (req, res) => {
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

module.exports = router;
