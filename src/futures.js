/**
 * Binance Futures Data - Market Sentiment & Liquidation Analysis
 *
 * Provides the same data that powers BitcoinCounterFlow's heatmap:
 * - Funding Rate (sentiment: are longs paying shorts or vice versa)
 * - Open Interest (total $ in futures contracts)
 * - Long/Short Ratio (market positioning)
 * - Taker Buy/Sell Volume (aggressive order flow)
 * - Liquidation zones estimation (from order book depth)
 *
 * All data sourced from Binance Futures API (free, no auth required)
 */

const fetch = require('node-fetch');

const FUTURES_BASE = 'https://fapi.binance.com';

// In-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 min cache for futures data

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ============================================================
// Funding Rate
// ============================================================

async function fetchFundingRate(symbol = 'BTCUSDT', limit = 30) {
  const cacheKey = `funding:${symbol}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${FUTURES_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });

  if (!res.ok) throw new Error(`Funding rate API error: ${res.status}`);

  const data = await res.json();
  const result = data.map(d => ({
    timestamp: d.fundingTime,
    rate: parseFloat(d.fundingRate),
  }));

  setCache(cacheKey, result);
  return result;
}

// ============================================================
// Open Interest
// ============================================================

async function fetchOpenInterest(symbol = 'BTCUSDT') {
  const cacheKey = `oi:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${FUTURES_BASE}/fapi/v1/openInterest?symbol=${symbol}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });

  if (!res.ok) throw new Error(`Open Interest API error: ${res.status}`);

  const data = await res.json();
  const result = {
    symbol: data.symbol,
    openInterest: parseFloat(data.openInterest),
    time: data.time,
  };

  setCache(cacheKey, result);
  return result;
}

async function fetchOpenInterestHist(symbol = 'BTCUSDT', period = '5m', limit = 30) {
  const cacheKey = `oihist:${symbol}:${period}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${FUTURES_BASE}/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });

  if (!res.ok) throw new Error(`OI History API error: ${res.status}`);

  const data = await res.json();
  const result = data.map(d => ({
    timestamp: d.timestamp,
    sumOpenInterest: parseFloat(d.sumOpenInterest),
    sumOpenInterestValue: parseFloat(d.sumOpenInterestValue),
  }));

  setCache(cacheKey, result);
  return result;
}

// ============================================================
// Long/Short Ratio
// ============================================================

async function fetchLongShortRatio(symbol = 'BTCUSDT', period = '5m', limit = 30) {
  const cacheKey = `lsratio:${symbol}:${period}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${FUTURES_BASE}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });

  if (!res.ok) throw new Error(`Long/Short API error: ${res.status}`);

  const data = await res.json();
  const result = data.map(d => ({
    timestamp: d.timestamp,
    longs: parseFloat(d.longAccount),
    shorts: parseFloat(d.shortAccount),
    ratio: parseFloat(d.longShortRatio),
  }));

  setCache(cacheKey, result);
  return result;
}

async function fetchTopTraderLongShort(symbol = 'BTCUSDT', period = '5m', limit = 30) {
  const cacheKey = `topls:${symbol}:${period}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${FUTURES_BASE}/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });

  if (!res.ok) throw new Error(`Top trader L/S API error: ${res.status}`);

  const data = await res.json();
  const result = data.map(d => ({
    timestamp: d.timestamp,
    longs: parseFloat(d.longAccount),
    shorts: parseFloat(d.shortAccount),
    ratio: parseFloat(d.longShortRatio),
  }));

  setCache(cacheKey, result);
  return result;
}

// ============================================================
// Taker Buy/Sell Volume
// ============================================================

async function fetchTakerVolume(symbol = 'BTCUSDT', period = '5m', limit = 30) {
  const cacheKey = `taker:${symbol}:${period}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${FUTURES_BASE}/futures/data/takerlongshortRatio?symbol=${symbol}&period=${period}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });

  if (!res.ok) throw new Error(`Taker volume API error: ${res.status}`);

  const data = await res.json();
  const result = data.map(d => ({
    timestamp: d.timestamp,
    buyVol: parseFloat(d.buyVol),
    sellVol: parseFloat(d.sellVol),
    ratio: parseFloat(d.buySellRatio),
  }));

  setCache(cacheKey, result);
  return result;
}

// ============================================================
// Liquidation Zones Estimation
// Uses order book depth to estimate where liquidations cluster.
// Liquidation heatmap logic: assume common leverage levels (5x, 10x, 20x, 50x, 100x)
// and calculate where positions at each leverage would get liquidated.
// ============================================================

async function fetchLiquidationZones(symbol = 'BTCUSDT', currentPrice) {
  const cacheKey = `liqzones:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Fetch order book depth
  const url = `${FUTURES_BASE}/fapi/v1/depth?symbol=${symbol}&limit=100`;
  const res = await fetch(url, { headers: { 'User-Agent': 'CryptoRSI/1.0' } });

  if (!res.ok) throw new Error(`Depth API error: ${res.status}`);

  const data = await res.json();

  // Calculate cumulative volume by price zone
  const bids = data.bids.map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) }));
  const asks = data.asks.map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty) }));

  const price = currentPrice || (bids.length > 0 ? bids[0].price : 0);

  // Estimate liquidation price levels for LONG positions at different leverages
  // Liquidation = entry * (1 - 1/leverage) for longs (maintenance margin ~0.4% ignored for simplicity)
  // Liquidation = entry * (1 + 1/leverage) for shorts
  const leverages = [5, 10, 20, 50, 100];

  const longLiqZones = leverages.map(lev => {
    const liqPrice = price * (1 - 1 / lev);
    // Find cumulative bid volume near this level (support)
    let supportVol = 0;
    for (const bid of bids) {
      if (bid.price >= liqPrice * 0.995 && bid.price <= liqPrice * 1.005) {
        supportVol += bid.qty;
      }
    }
    return { leverage: lev, liqPrice, side: 'long', volume: supportVol };
  });

  const shortLiqZones = leverages.map(lev => {
    const liqPrice = price * (1 + 1 / lev);
    let resistanceVol = 0;
    for (const ask of asks) {
      if (ask.price >= liqPrice * 0.995 && ask.price <= liqPrice * 1.005) {
        resistanceVol += ask.qty;
      }
    }
    return { leverage: lev, liqPrice, side: 'short', volume: resistanceVol };
  });

  const result = {
    currentPrice: price,
    longZones: longLiqZones,
    shortZones: shortLiqZones,
    orderBook: {
      bidDepth: bids.slice(0, 20),
      askDepth: asks.slice(0, 20),
      totalBidVol: bids.reduce((s, b) => s + b.qty, 0),
      totalAskVol: asks.reduce((s, a) => s + a.qty, 0),
    },
  };

  setCache(cacheKey, result);
  return result;
}

// ============================================================
// Comprehensive Market Analysis
// ============================================================

async function getMarketAnalysis(symbol = 'BTCUSDT') {
  const results = await Promise.allSettled([
    fetchFundingRate(symbol, 30),
    fetchOpenInterest(symbol),
    fetchOpenInterestHist(symbol, '5m', 30),
    fetchLongShortRatio(symbol, '5m', 30),
    fetchTopTraderLongShort(symbol, '5m', 30),
    fetchTakerVolume(symbol, '5m', 30),
  ]);

  const [fundingRate, openInterest, oiHistory, lsRatio, topLsRatio, takerVol] =
    results.map(r => r.status === 'fulfilled' ? r.value : null);

  // Get current price for liquidation zones
  let currentPrice = null;
  try {
    const priceRes = await fetch(`${FUTURES_BASE}/fapi/v1/ticker/price?symbol=${symbol}`, {
      headers: { 'User-Agent': 'CryptoRSI/1.0' }
    });
    const priceData = await priceRes.json();
    currentPrice = parseFloat(priceData.price);
  } catch (e) { /* ignore */ }

  let liqZones = null;
  if (currentPrice) {
    try {
      liqZones = await fetchLiquidationZones(symbol, currentPrice);
    } catch (e) { /* ignore */ }
  }

  // ---- Sentiment Interpretation ----
  const sentiment = interpretSentiment({
    fundingRate, openInterest, oiHistory, lsRatio, topLsRatio, takerVol, currentPrice
  });

  return {
    symbol,
    currentPrice,
    fundingRate,
    openInterest,
    oiHistory,
    longShortRatio: lsRatio,
    topTraderRatio: topLsRatio,
    takerVolume: takerVol,
    liquidationZones: liqZones,
    sentiment,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================
// Sentiment Interpretation Engine
// ============================================================

function interpretSentiment(data) {
  const signals = [];
  let score = 0; // -100 (extreme bear) to +100 (extreme bull)

  // 1) Funding Rate analysis
  if (data.fundingRate && data.fundingRate.length > 0) {
    const currentFR = data.fundingRate[data.fundingRate.length - 1].rate;
    const avgFR = data.fundingRate.reduce((s, d) => s + d.rate, 0) / data.fundingRate.length;

    if (currentFR > 0.05) {
      signals.push({
        indicator: 'Funding Rate',
        value: (currentFR * 100).toFixed(4) + '%',
        signal: 'bearish',
        reason: `Funding rate muy alto (${(currentFR * 100).toFixed(4)}%). Longs pagan mucho a shorts. Posible sobrecompra y corrección inminente. Los traders están muy apalancados en long.`,
        weight: -25,
      });
      score -= 25;
    } else if (currentFR > 0.01) {
      signals.push({
        indicator: 'Funding Rate',
        value: (currentFR * 100).toFixed(4) + '%',
        signal: 'neutral-bull',
        reason: `Funding rate positivo moderado (${(currentFR * 100).toFixed(4)}%). Sentimiento alcista pero no extremo. Más longs que shorts.`,
        weight: 10,
      });
      score += 10;
    } else if (currentFR < -0.05) {
      signals.push({
        indicator: 'Funding Rate',
        value: (currentFR * 100).toFixed(4) + '%',
        signal: 'bullish',
        reason: `Funding rate muy negativo (${(currentFR * 100).toFixed(4)}%). Shorts pagan a longs. Posible sobreventa. Históricamente, esto precede rebotes fuertes (short squeeze).`,
        weight: 30,
      });
      score += 30;
    } else if (currentFR < -0.01) {
      signals.push({
        indicator: 'Funding Rate',
        value: (currentFR * 100).toFixed(4) + '%',
        signal: 'neutral-bear',
        reason: `Funding rate negativo (${(currentFR * 100).toFixed(4)}%). Más shorts que longs. Presión bajista.`,
        weight: -10,
      });
      score -= 10;
    } else {
      signals.push({
        indicator: 'Funding Rate',
        value: (currentFR * 100).toFixed(4) + '%',
        signal: 'neutral',
        reason: `Funding rate neutro (${(currentFR * 100).toFixed(4)}%). Mercado equilibrado.`,
        weight: 0,
      });
    }

    // Trend in funding rate
    if (data.fundingRate.length >= 5) {
      const recent5 = data.fundingRate.slice(-5).map(d => d.rate);
      const avgRecent = recent5.reduce((a, b) => a + b, 0) / recent5.length;
      if (avgRecent > avgFR * 1.5 && avgFR > 0) {
        signals.push({
          indicator: 'Funding Rate Trend',
          value: 'Rising',
          signal: 'bearish',
          reason: `El funding rate está subiendo sostenidamente. Los longs están aumentando su apalancamiento, lo que aumenta el riesgo de una liquidación en cascada si el precio baja.`,
          weight: -15,
        });
        score -= 15;
      } else if (avgRecent < avgFR * 0.5 && avgFR < 0) {
        signals.push({
          indicator: 'Funding Rate Trend',
          value: 'Falling',
          signal: 'bullish',
          reason: `El funding rate negativo se está reduciendo. Los shorts están cerrando posiciones, lo que reduce la presión vendedora.`,
          weight: 10,
        });
        score += 10;
      }
    }
  }

  // 2) Long/Short Ratio analysis
  if (data.lsRatio && data.lsRatio.length > 0) {
    const currentRatio = data.lsRatio[data.lsRatio.length - 1].ratio;
    const longs = data.lsRatio[data.lsRatio.length - 1].longs;
    const shorts = data.lsRatio[data.lsRatio.length - 1].shorts;

    if (currentRatio > 2.0) {
      signals.push({
        indicator: 'Long/Short Ratio',
        value: currentRatio.toFixed(2),
        signal: 'bearish',
        reason: `Ratio extremadamente alto (${currentRatio.toFixed(2)}). ${(longs * 100).toFixed(1)}% longs vs ${(shorts * 100).toFixed(1)}% shorts. Contrarian: cuando la mayoría está en long, hay riesgo de short squeeze reverso (liquidación masiva de longs).`,
        weight: -20,
      });
      score -= 20;
    } else if (currentRatio > 1.3) {
      signals.push({
        indicator: 'Long/Short Ratio',
        value: currentRatio.toFixed(2),
        signal: 'neutral-bull',
        reason: `Más longs que shorts (${(longs * 100).toFixed(1)}% vs ${(shorts * 100).toFixed(1)}%). Sentimiento alcista moderado.`,
        weight: 5,
      });
      score += 5;
    } else if (currentRatio < 0.5) {
      signals.push({
        indicator: 'Long/Short Ratio',
        value: currentRatio.toFixed(2),
        signal: 'bullish',
        reason: `Ratio muy bajo (${currentRatio.toFixed(2)}). ${(shorts * 100).toFixed(1)}% shorts. Contrarian: cuando la mayoría está en short, hay potencial de short squeeze (liquidación masiva de shorts que dispara el precio).`,
        weight: 25,
      });
      score += 25;
    } else if (currentRatio < 0.8) {
      signals.push({
        indicator: 'Long/Short Ratio',
        value: currentRatio.toFixed(2),
        signal: 'neutral-bear',
        reason: `Más shorts que longs (${(shorts * 100).toFixed(1)}% vs ${(longs * 100).toFixed(1)}%). Presión bajista en el mercado de futuros.`,
        weight: -5,
      });
      score -= 5;
    } else {
      signals.push({
        indicator: 'Long/Short Ratio',
        value: currentRatio.toFixed(2),
        signal: 'neutral',
        reason: `Ratio equilibrado (${(longs * 100).toFixed(1)}% longs, ${(shorts * 100).toFixed(1)}% shorts).`,
        weight: 0,
      });
    }
  }

  // 3) Top Traders Long/Short (smart money)
  if (data.topLsRatio && data.topLsRatio.length > 0) {
    const topRatio = data.topLsRatio[data.topLsRatio.length - 1].ratio;
    const topLongs = data.topLsRatio[data.topLsRatio.length - 1].longs;
    const topShorts = data.topLsRatio[data.topLsRatio.length - 1].shorts;

    if (topRatio > 1.5) {
      signals.push({
        indicator: 'Top Traders (Smart Money)',
        value: topRatio.toFixed(2),
        signal: 'bullish',
        reason: `Top traders predominantemente long (${(topLongs * 100).toFixed(1)}%). El "dinero inteligente" está posicionado alcista.`,
        weight: 20,
      });
      score += 20;
    } else if (topRatio < 0.7) {
      signals.push({
        indicator: 'Top Traders (Smart Money)',
        value: topRatio.toFixed(2),
        signal: 'bearish',
        reason: `Top traders predominantemente short (${(topShorts * 100).toFixed(1)}%). El "dinero inteligente" está posicionado bajista. Señal de precaución.`,
        weight: -20,
      });
      score -= 20;
    } else {
      signals.push({
        indicator: 'Top Traders (Smart Money)',
        value: topRatio.toFixed(2),
        signal: 'neutral',
        reason: `Top traders con posiciones equilibradas. No hay consenso claro entre grandes traders.`,
        weight: 0,
      });
    }
  }

  // 4) Taker Buy/Sell Volume
  if (data.takerVolume && data.takerVolume.length > 0) {
    const currentTaker = data.takerVolume[data.takerVolume.length - 1];
    const avgTakerRatio = data.takerVolume.reduce((s, d) => s + d.ratio, 0) / data.takerVolume.length;

    if (currentTaker.ratio > 1.5) {
      signals.push({
        indicator: 'Taker Volume (Flujo)',
        value: currentTaker.ratio.toFixed(2),
        signal: 'bullish',
        reason: `Compradores agresivos dominan (ratio ${currentTaker.ratio.toFixed(2)}). Las órdenes de compra market están superando a las de venta. Flujo de dinero entrante.`,
        weight: 15,
      });
      score += 15;
    } else if (currentTaker.ratio < 0.7) {
      signals.push({
        indicator: 'Taker Volume (Flujo)',
        value: currentTaker.ratio.toFixed(2),
        signal: 'bearish',
        reason: `Vendedores agresivos dominan (ratio ${currentTaker.ratio.toFixed(2)}). Las órdenes de venta market están superando a las de compra. Presión vendedora activa.`,
        weight: -15,
      });
      score -= 15;
    } else {
      signals.push({
        indicator: 'Taker Volume (Flujo)',
        value: currentTaker.ratio.toFixed(2),
        signal: 'neutral',
        reason: `Flujo de órdenes equilibrado (ratio ${currentTaker.ratio.toFixed(2)}). No hay dominio claro de compradores o vendedores.`,
        weight: 0,
      });
    }
  }

  // 5) Open Interest analysis
  if (data.oiHistory && data.oiHistory.length >= 5) {
    const latest = data.oiHistory[data.oiHistory.length - 1].sumOpenInterestValue;
    const previous = data.oiHistory[data.oiHistory.length - 5].sumOpenInterestValue;
    const oiChange = ((latest - previous) / previous) * 100;

    if (oiChange > 10) {
      signals.push({
        indicator: 'Open Interest',
        value: `+$${(latest / 1e6).toFixed(1)}M (${oiChange > 0 ? '+' : ''}${oiChange.toFixed(1)}%)`,
        signal: 'bullish',
        reason: `Open Interest creciendo significativamente (+${oiChange.toFixed(1)}%). Nuevo dinero entrando en futuros. Si el precio sube, refuerza la tendencia alcista.`,
        weight: 15,
      });
      score += 15;
    } else if (oiChange < -10) {
      signals.push({
        indicator: 'Open Interest',
        value: `$${(latest / 1e6).toFixed(1)}M (${oiChange.toFixed(1)}%)`,
        signal: 'bearish',
        reason: `Open Interest cayendo (${oiChange.toFixed(1)}%). Posiciones cerrándose, posiblemente por liquidaciones. Pérdida de interés en el mercado.`,
        weight: -10,
      });
      score -= 10;
    } else {
      signals.push({
        indicator: 'Open Interest',
        value: `$${(latest / 1e6).toFixed(1)}M (${oiChange > 0 ? '+' : ''}${oiChange.toFixed(1)}%)`,
        signal: 'neutral',
        reason: `Open Interest estable (${oiChange.toFixed(1)}%). No hay entrada/salida significativa de capital nuevo.`,
        weight: 0,
      });
    }
  }

  // 6) Liquidation zones (magnetic zones)
  if (data.currentPrice) {
    // Will be enhanced with actual liq zones data
  }

  // Clamp score
  score = Math.max(-100, Math.min(100, score));

  // Overall interpretation
  let overall, action, color, emoji;
  if (score >= 50) {
    overall = 'MUY ALCISTA';
    action = 'Fuerte presión compradora. Potencial subida. Pero cuidado con pullback si hay sobrecompra.';
    color = '#16a34a';
  } else if (score >= 20) {
    overall = 'ALCISTA';
    action = 'Datos favorecen subida. Sentimiento positivo sin extremos.';
    color = '#22c55e';
  } else if (score >= -20) {
    overall = 'NEUTRAL';
    action = 'Sin señal clara. Mercado indeciso. Mejor esperar.';
    color = '#eab308';
  } else if (score >= -50) {
    overall = 'BAJISTA';
    action = 'Datos favorecen bajada. Presión vendedora activa.';
    color = '#f97316';
  } else {
    overall = 'MUY BAJISTA';
    action = 'Fuerte presión vendedora. Pero cuidado con short squeeze si hay exceso de shorts.';
    color = '#ef4444';
  }

  return {
    score,
    overall,
    action,
    color,
    signals,
  };
}

module.exports = {
  fetchFundingRate,
  fetchOpenInterest,
  fetchOpenInterestHist,
  fetchLongShortRatio,
  fetchTopTraderLongShort,
  fetchTakerVolume,
  fetchLiquidationZones,
  getMarketAnalysis,
};
