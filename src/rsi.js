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
 * Find local extrema (peaks and troughs) in an array
 * @returns {Array<{index: number, value: number}>} Array of extrema
 */
function findPeaks(arr) {
  const peaks = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1]) {
      peaks.push({ index: i, value: arr[i] });
    }
    // Also include flat peaks (equal to neighbors)
    if (arr[i] >= arr[i - 1] && arr[i] > arr[i + 1] && arr[i] >= arr[i - 2]) {
      if (peaks.length === 0 || peaks[peaks.length - 1].index !== i) {
        peaks.push({ index: i, value: arr[i] });
      }
    }
  }
  return peaks;
}

function findTroughs(arr) {
  const troughs = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] < arr[i - 1] && arr[i] < arr[i + 1]) {
      troughs.push({ index: i, value: arr[i] });
    }
    if (arr[i] <= arr[i - 1] && arr[i] < arr[i + 1] && arr[i] <= arr[i - 2]) {
      if (troughs.length === 0 || troughs[troughs.length - 1].index !== i) {
        troughs.push({ index: i, value: arr[i] });
      }
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
function detectDivergence(closes, rsiValues, lookback = 30) {
  if (!closes || !rsiValues || closes.length < 10 || rsiValues.length < 10) {
    return { bullish: false, bearish: false, strength: 'none', reason: null };
  }

  // rsiValues starts after `period` closes, so we align them
  // rsiValues[0] corresponds to closes[period]
  const offset = closes.length - rsiValues.length;
  const recentCloses = closes.slice(-lookback);
  const recentRSI = rsiValues.slice(-lookback);

  if (recentRSI.length < 5) {
    return { bullish: false, bearish: false, strength: 'none', reason: null };
  }

  // Find troughs (for bullish divergence)
  const priceTroughs = findTroughs(recentCloses);
  const rsiTroughs = findTroughs(recentRSI);

  // Find peaks (for bearish divergence)
  const pricePeaks = findPeaks(recentCloses);
  const rsiPeaks = findPeaks(recentRSI);

  let bullish = false;
  let bearish = false;
  let bullStrength = 'none';
  let bearStrength = 'none';
  let reason = null;

  // Bullish divergence: need at least 2 troughs
  // Price troughs go DOWN but RSI troughs go UP
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

  // Bearish divergence: need at least 2 peaks
  // Price peaks go UP but RSI peaks go DOWN
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
