/**
 * Market Analysis Routes
 */

const { Router } = require('express');
const { getMarketAnalysis } = require('../futures');

const router = Router();

router.get('/market/:symbol', async (req, res) => {
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

module.exports = router;
