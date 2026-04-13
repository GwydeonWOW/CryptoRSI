/**
 * RSI (Relative Strength Index) Calculator
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

/**
 * Get a recommendation based on RSI value.
 * @param {number} rsi - Current RSI value
 * @returns {{ action: string, label: string, color: string, reason: string }}
 */
function getRecommendation(rsi) {
  if (rsi >= 70) {
    return {
      action: 'sell',
      label: 'VENDER',
      color: '#ef4444',
      reason: 'RSI alto (sobrecompra) - Posible corrección a la baja'
    };
  } else if (rsi <= 30) {
    return {
      action: 'buy',
      label: 'COMPRAR',
      color: '#22c55e',
      reason: 'RSI bajo (sobreventa) - Posible rebote al alza'
    };
  } else if (rsi >= 60) {
    return {
      action: 'wait',
      label: 'ESPERAR (tendencia alcista)',
      color: '#eab308',
      reason: 'RSI neutral-alto - Tendencia alcista pero cerca de sobrecompra'
    };
  } else if (rsi <= 40) {
    return {
      action: 'wait',
      label: 'ESPERAR (tendencia bajista)',
      color: '#f97316',
      reason: 'RSI neutral-bajo - Tendencia bajista pero cerca de sobreventa'
    };
  } else {
    return {
      action: 'wait',
      label: 'ESPERAR',
      color: '#6b7280',
      reason: 'RSI en zona neutral - Sin señal clara'
    };
  }
}

/**
 * Calculate RSI for multiple timeframes
 * @param {Object} candlesByTimeframe - { '1h': closes[], '4h': closes[], '1d': closes[] }
 * @param {number} period
 * @returns {Object} RSI data per timeframe
 */
function calculateMultiTimeframeRSI(candlesByTimeframe, period = 14) {
  const result = {};

  for (const [timeframe, closes] of Object.entries(candlesByTimeframe)) {
    const rsiValues = calculateRSI(closes, period);
    const currentRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
    const recommendation = currentRSI !== null ? getRecommendation(currentRSI) : null;

    result[timeframe] = {
      rsi: currentRSI,
      rsiHistory: rsiValues.slice(-10), // Last 10 RSI values for mini chart
      recommendation,
      dataPoints: closes.length
    };
  }

  return result;
}

module.exports = { calculateRSI, getRecommendation, calculateMultiTimeframeRSI };
