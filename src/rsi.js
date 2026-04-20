/**
 * RSI (Relative Strength Index) Calculator + Divergence Detection
 *
 * RSI = 100 - (100 / (1 + RS))
 * RS = Average Gain / Average Loss over N periods (typically 14)
 *
 * Uses Wilder's Smoothing (exponential) for ongoing calculations.
 */

/**
 * Calculate RSI from an array of closing prices.
 * @param {number[]} closes - Array of closing prices (oldest first)
 * @param {number} period - RSI period (default 14)
 * @returns {number[]} Array of RSI values (length = closes.length - period)
 */
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) {
    return [];
  }

  const rsiValues = [];
  const gains = [];
  const losses = [];

  // Calculate initial price changes
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // First RSI: simple average of first `period` gains/losses
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiValues.push(100 - 100 / (1 + rs));

  // Subsequent RSI values: Wilder's Smoothing
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - 100 / (1 + rs));
  }

  return rsiValues;
}

// ============================================================
// Divergence Detection
// ============================================================

/**
 * Find local peaks using pivot lookback (TradingView-style).
 * A peak at index i is confirmed when arr[i] >= all values
 * within `leftBars` to the left and `rightBars` to the right.
 *
 * @param {number[]} arr - Data array
 * @param {number} leftBars - Bars to check left (default 5)
 * @param {number} rightBars - Bars to check right (default 5)
 * @returns {Array<{index: number, value: number}>}
 */
function findPeaks(arr, leftBars = 5, rightBars = 5) {
  const peaks = [];
  for (let i = leftBars; i < arr.length - rightBars; i++) {
    let isPeak = true;
    for (let l = 1; l <= leftBars; l++) {
      if (arr[i] < arr[i - l]) { isPeak = false; break; }
    }
    if (!isPeak) continue;
    for (let r = 1; r <= rightBars; r++) {
      if (arr[i] < arr[i + r]) { isPeak = false; break; }
    }
    if (isPeak) {
      peaks.push({ index: i, value: arr[i] });
    }
  }
  return peaks;
}

/**
 * Find local troughs using pivot lookback (TradingView-style).
 * A trough at index i is confirmed when arr[i] <= all values
 * within `leftBars` to the left and `rightBars` to the right.
 */
function findTroughs(arr, leftBars = 5, rightBars = 5) {
  const troughs = [];
  for (let i = leftBars; i < arr.length - rightBars; i++) {
    let isTrough = true;
    for (let l = 1; l <= leftBars; l++) {
      if (arr[i] > arr[i - l]) { isTrough = false; break; }
    }
    if (!isTrough) continue;
    for (let r = 1; r <= rightBars; r++) {
      if (arr[i] > arr[i + r]) { isTrough = false; break; }
    }
    if (isTrough) {
      troughs.push({ index: i, value: arr[i] });
    }
  }
  return troughs;
}

/**
 * Detect RSI Divergence
 *
 * Bullish Divergence: Price makes LOWER low, but RSI makes HIGHER low → BUY signal
 *   (Selling pressure weakening, potential reversal up)
 *
 * Bearish Divergence: Price makes HIGHER high, but RSI makes LOWER high → SELL signal
 *   (Buying pressure weakening, potential reversal down)
 *
 * @param {number[]} closes - Array of closing prices (oldest first)
 * @param {number[]} rsiValues - Array of RSI values (same length mapping)
 * @param {number} lookback - How many periods to analyze (default 30)
 * @returns {{ bullish: boolean, bearish: boolean, strength: string, reason: string|null }}
 */
function detectDivergence(closes, rsiValues, options = {}) {
  const {
    maxLookback = 60,
    minLookback = 5,
    pivotLeft = 5,
    pivotRight = 5,
  } = options;

  if (!closes || !rsiValues || closes.length < 10 || rsiValues.length < 10) {
    return { bullish: false, bearish: false, strength: 'none', reason: null };
  }

  // Align closes with rsiValues (rsi starts after `period` closes)
  const alignedCloses = closes.slice(closes.length - rsiValues.length);

  // Use maxLookback range, but ensure at least minLookback bars
  const lookback = Math.min(maxLookback, alignedCloses.length);
  if (lookback < minLookback) {
    return { bullish: false, bearish: false, strength: 'none', reason: null };
  }

  const recentCloses = alignedCloses.slice(-lookback);
  const recentRSI = rsiValues.slice(-lookback);

  // Find pivots with TradingView-style lookback
  const priceTroughs = findTroughs(recentCloses, pivotLeft, pivotRight);
  const rsiTroughs = findTroughs(recentRSI, pivotLeft, pivotRight);
  const pricePeaks = findPeaks(recentCloses, pivotLeft, pivotRight);
  const rsiPeaks = findPeaks(recentRSI, pivotLeft, pivotRight);

  let bullish = false;
  let bearish = false;
  let bullStrength = 'none';
  let bearStrength = 'none';
  let reason = null;

  // Regular Bullish divergence: price lower low + RSI higher low
  if (priceTroughs.length >= 2 && rsiTroughs.length >= 2) {
    const lastPriceTrough = priceTroughs[priceTroughs.length - 1];
    const prevPriceTrough = priceTroughs[priceTroughs.length - 2];
    const lastRSITrough = rsiTroughs[rsiTroughs.length - 1];
    const prevRSITrough = rsiTroughs[rsiTroughs.length - 2];

    const priceGoingDown = lastPriceTrough.value < prevPriceTrough.value;
    const rsiGoingUp = lastRSITrough.value > prevRSITrough.value;

    if (priceGoingDown && rsiGoingUp) {
      bullish = true;
      const priceDrop = ((prevPriceTrough.value - lastPriceTrough.value) / prevPriceTrough.value) * 100;
      const rsiRise = lastRSITrough.value - prevRSITrough.value;

      if (priceDrop > 5 && rsiRise > 10) bullStrength = 'strong';
      else if (priceDrop > 2 && rsiRise > 5) bullStrength = 'normal';
      else bullStrength = 'weak';

      reason = `Precio bajo ${priceDrop.toFixed(1)}% pero RSI subio ${rsiRise.toFixed(1)} puntos`;
    }
  }

  // Regular Bearish divergence: price higher high + RSI lower high
  if (pricePeaks.length >= 2 && rsiPeaks.length >= 2) {
    const lastPricePeak = pricePeaks[pricePeaks.length - 1];
    const prevPricePeak = pricePeaks[pricePeaks.length - 2];
    const lastRSIPeak = rsiPeaks[rsiPeaks.length - 1];
    const prevRSIPeak = rsiPeaks[rsiPeaks.length - 2];

    const priceGoingUp = lastPricePeak.value > prevPricePeak.value;
    const rsiGoingDown = lastRSIPeak.value < prevRSIPeak.value;

    if (priceGoingUp && rsiGoingDown) {
      bearish = true;
      const priceRise = ((lastPricePeak.value - prevPricePeak.value) / prevPricePeak.value) * 100;
      const rsiDrop = prevRSIPeak.value - lastRSIPeak.value;

      if (priceRise > 5 && rsiDrop > 10) bearStrength = 'strong';
      else if (priceRise > 2 && rsiDrop > 5) bearStrength = 'normal';
      else bearStrength = 'weak';

      reason = `Precio subio ${priceRise.toFixed(1)}% pero RSI bajo ${rsiDrop.toFixed(1)} puntos`;
    }
  }

  const strength = bullish ? bullStrength : bearish ? bearStrength : 'none';

  return { bullish, bearish, strength, reason };
}

/**
 * Get a recommendation based on RSI value and divergence signal.
 * Divergence takes priority over simple RSI thresholds.
 */
function getRecommendation(rsi, divergence) {
  // Divergence signals take priority
  if (divergence && divergence.bullish) {
    const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? '' : 'DEBIL';
    return {
      action: 'buy',
      label: `COMPRAR${strengthLabel ? ' (' + strengthLabel + ')' : ''}`,
      color: '#22c55e',
      reason: `Divergencia alcista: ${divergence.reason || 'Precio baja pero RSI sube'}`,
    };
  }

  if (divergence && divergence.bearish) {
    const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? '' : 'DEBIL';
    return {
      action: 'sell',
      label: `VENDER${strengthLabel ? ' (' + strengthLabel + ')' : ''}`,
      color: '#ef4444',
      reason: `Divergencia bajista: ${divergence.reason || 'Precio sube pero RSI baja'}`,
    };
  }

  // Fallback to classic RSI thresholds
  if (rsi >= 70) {
    return { action: 'sell', label: 'VENDER', color: '#ef4444', reason: 'RSI alto (sobrecompra) - Posible correccion' };
  } else if (rsi <= 30) {
    return { action: 'buy', label: 'COMPRAR', color: '#22c55e', reason: 'RSI bajo (sobreventa) - Posible rebote' };
  } else if (rsi >= 60) {
    return { action: 'wait', label: 'ESPERAR (alcista)', color: '#eab308', reason: 'RSI neutral-alto' };
  } else if (rsi <= 40) {
    return { action: 'wait', label: 'ESPERAR (bajista)', color: '#f97316', reason: 'RSI neutral-bajo' };
  } else {
    return { action: 'wait', label: 'ESPERAR', color: '#6b7280', reason: 'RSI en zona neutral' };
  }
}

/**
 * Calculate RSI for multiple timeframes with divergence detection
 * @param {Object} candlesByTimeframe - { '1h': closes[], '4h': closes[], '1d': closes[] }
 * @param {number} period
 * @returns {Object} RSI data per timeframe including divergence
 */
function calculateMultiTimeframeRSI(candlesByTimeframe, period = 14) {
  const result = {};

  for (const [timeframe, closes] of Object.entries(candlesByTimeframe)) {
    const rsiValues = calculateRSI(closes, period);
    const currentRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;

    // Detect divergence for this timeframe
    const divergence = detectDivergence(closes, rsiValues);

    const recommendation = currentRSI !== null ? getRecommendation(currentRSI, divergence) : null;

    result[timeframe] = {
      rsi: currentRSI,
      rsiHistory: rsiValues.slice(-10),
      recommendation,
      divergence,
      dataPoints: closes.length,
    };
  }

  return result;
}

module.exports = { calculateRSI, getRecommendation, calculateMultiTimeframeRSI, detectDivergence };
