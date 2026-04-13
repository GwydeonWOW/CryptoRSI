/**
 * Token Configuration Store
 * Simple JSON file-based storage for tracked tokens
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'tokens.json');

const DEFAULT_TOKENS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'BNB', name: 'BNB' },
  { symbol: 'ADA', name: 'Cardano' }
];

function ensureDataDir() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadTokens() {
  ensureDataDir();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading tokens:', e.message);
  }
  saveTokens(DEFAULT_TOKENS);
  return DEFAULT_TOKENS;
}

function saveTokens(tokens) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(tokens, null, 2));
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

module.exports = { loadTokens, addToken, removeToken };
