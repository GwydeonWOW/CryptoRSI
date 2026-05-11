/**
 * Token Routes — CRUD for tracked tokens
 */

const { Router } = require('express');
const { authMiddleware, adminMiddleware, moderatorMiddleware } = require('../auth');
const { loadTokens, addToken, removeToken } = require('../config');
const { validateAddToken, handleValidationErrors } = require('../middleware/validate');

const router = Router();

router.get('/tokens', (req, res) => {
  res.json(loadTokens());
});

router.post('/tokens', authMiddleware, moderatorMiddleware, validateAddToken, handleValidationErrors, (req, res) => {
  const { symbol, name } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  const result = addToken(symbol, name);
  res.json(result);
});

router.delete('/tokens/:symbol', authMiddleware, moderatorMiddleware, (req, res) => {
  const result = removeToken(req.params.symbol);
  res.json(result);
});

module.exports = router;
