const { getDataDir, readJSON, writeJSON } = require('./storage');
const path = require('path');

const FILE = path.join(getDataDir(), 'sent_signals.json');
let signals = {};

function load() {
  signals = readJSON(FILE, {});
  const now = Date.now();
  for (const key of Object.keys(signals)) {
    if (typeof signals[key] !== 'number') delete signals[key];
  }
}

function get(key) {
  return signals[key] || null;
}

function set(key, timestamp) {
  signals[key] = timestamp;
  save();
}

function save() {
  writeJSON(FILE, signals);
}

load();

module.exports = { get, set };
