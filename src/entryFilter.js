/**
 * Entry Filter Engine — Configurable conditions for trade entry decisions.
 *
 * Each condition: field op target * mult
 * Combined with AND/OR logic.
 * Action: "skip" (don't trade when matched) or "allow" (only trade when matched).
 */

const FIELDS = ['price', 'sma200_1h', 'sma200_4h', 'rsi', 'rsi1h', 'rsi4h', 'rsi1d', 'rsi15m'];
const OPS = ['>=', '<=', '>', '<', '=='];

function getFieldValue(field, data) {
  switch (field) {
    case 'price': return data.price;
    case 'sma200_1h': return data.sma200_1h;
    case 'sma200_4h': return data.sma200_4h;
    case 'rsi': return data.rsi;
    case 'rsi1h': return data.rsi1h;
    case 'rsi4h': return data.rsi4h;
    case 'rsi1d': return data.rsi1d;
    case 'rsi15m': return data.rsi15m;
    default: return null;
  }
}

function evaluateCondition(condition, data) {
  const fieldVal = getFieldValue(condition.field, data);
  if (fieldVal == null) return false;

  let compareVal;
  if (condition.target && condition.target !== 'value') {
    const targetVal = getFieldValue(condition.target, data);
    if (targetVal == null) return false;
    compareVal = targetVal * (condition.mult ?? 1);
  } else {
    compareVal = condition.value ?? 0;
  }

  switch (condition.op) {
    case '>=': return fieldVal >= compareVal;
    case '<=': return fieldVal <= compareVal;
    case '>': return fieldVal > compareVal;
    case '<': return fieldVal < compareVal;
    case '==': return fieldVal === compareVal;
    default: return false;
  }
}

/**
 * Evaluate the entry filter against market data.
 * Returns true = SKIP this trade, false = ALLOW this trade.
 */
function shouldSkip(filter, data) {
  if (!filter || !filter.enabled) return false;

  const conditions = (filter.conditions || []).filter(c => c.enabled !== false);
  if (conditions.length === 0) return false;

  const results = conditions.map(c => evaluateCondition(c, data));
  const matched = filter.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);

  return filter.action === 'skip' ? matched : !matched;
}

module.exports = { shouldSkip, FIELDS, OPS };
