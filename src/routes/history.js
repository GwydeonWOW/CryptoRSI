/**
 * Historical Data Routes
 */

const { Router } = require('express');
const { getRSIHistory, getMarketHistory, getPriceHistory } = require('../storage');

const router = Router();

router.get('/history/rsi/:symbol', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const history = getRSIHistory(req.params.symbol, days);
  res.json(history);
});

router.get('/history/market', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  res.json(getMarketHistory(days));
});

router.get('/history/prices/:symbol', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  res.json(getPriceHistory(req.params.symbol, days));
});

module.exports = router;
