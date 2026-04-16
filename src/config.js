/**
 * Token Configuration Store
 * Simple JSON file-based storage for tracked tokens
 */

const path = require('path');
const { getDataDir, ensureDataDir, readJSON, writeJSON } = require('./storage');

const CONFIG_PATH = path.join(getDataDir(), 'tokens.json');

const DEFAULT_TOKENS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'BNB', name: 'BNB' },
  { symbol: 'ADA', name: 'Cardano' }
];

function loadTokens() {
  ensureDataDir();
  const tokens = readJSON(CONFIG_PATH, null);
  if (tokens) return tokens;
  saveTokens(DEFAULT_TOKENS);
  return DEFAULT_TOKENS;
}

function saveTokens(tokens) {
  writeJSON(CONFIG_PATH, tokens);
}

function addToken(symbol, name) {
  const tokens = loadTokens();
  const upper = symbol.toUpperCase();
  if (tokens.find(t => t.symbol === upper)) {
    return { success: false, message: `${upper} ya está en la lista` };
  }
  tokens.push({ symbol: upper, name: name || upper });
  saveTokens(tokens);
  return { success: true, message: `${upper} añadido correctamente` };
}

function removeToken(symbol) {
  let tokens = loadTokens();
  const upper = symbol.toUpperCase();
  const before = tokens.length;
  tokens = tokens.filter(t => t.symbol !== upper);
  if (tokens.length === before) {
    return { success: false, message: `${upper} no encontrado` };
  }
  saveTokens(tokens);
  return { success: true, message: `${upper} eliminado correctamente` };
}

module.exports = { loadTokens, addToken, removeToken, CONFIG_PATH };
