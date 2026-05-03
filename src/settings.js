/**
 * Settings Store - Persistent configuration for notifications and alerts
 */

const path = require('path');
const { getDataDir, ensureDataDir, readJSON, writeJSON } = require('./storage');

const SETTINGS_PATH = path.join(getDataDir(), 'settings.json');

const DEFAULT_SETTINGS = {
  telegram: {
    botToken: '',
    chatId: '',
    enabled: false,
  },
  discord: {
    webhookUrl: '',
    enabled: false,
  },
  alerts: {
    generic: {
      rsiOversold: 30,
      rsiOverbought: 70,
      divergenceBullish: true,
      divergenceBearish: true,
      sentimentExtreme: true,
      cooldownMinutes: 240,
      alertTimeframe: '1d',
    },
    tokens: {},
  },
};

function _mergeWithDefaults(settings) {
  if (!settings) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    telegram: { ...DEFAULT_SETTINGS.telegram, ...(settings.telegram || {}) },
    discord: { ...DEFAULT_SETTINGS.discord, ...(settings.discord || {}) },
    alerts: {
      generic: { ...DEFAULT_SETTINGS.alerts.generic, ...((settings.alerts || {}).generic || {}) },
      tokens: { ...((settings.alerts || {}).tokens || {}) },
    },
  };
}

function _readRaw() {
  ensureDataDir();
  return readJSON(SETTINGS_PATH, null);
}

function loadSettings() {
  const settings = _readRaw();
  if (!settings) {
    writeJSON(SETTINGS_PATH, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  return _mergeWithDefaults(settings);
}

function saveSettings(updates) {
  const raw = _readRaw();
  const current = _mergeWithDefaults(raw);
  const merged = {
    telegram: { ...current.telegram, ...(updates.telegram || {}) },
    discord: { ...current.discord, ...(updates.discord || {}) },
    alerts: {
      generic: { ...current.alerts.generic, ...((updates.alerts || {}).generic || {}) },
      tokens: { ...current.alerts.tokens, ...((updates.alerts || {}).tokens || {}) },
    },
  };
  writeJSON(SETTINGS_PATH, merged);
  return merged;
}

function getAlertConfig(symbol) {
  const settings = loadSettings();
  const generic = settings.alerts.generic;
  const tokenOverrides = settings.alerts.tokens[symbol.toUpperCase()] || {};
  return { ...generic, ...tokenOverrides };
}

function setTokenAlerts(symbol, config) {
  const settings = loadSettings();
  settings.alerts.tokens[symbol.toUpperCase()] = config;
  writeJSON(SETTINGS_PATH, settings);
  return settings;
}

function removeTokenAlerts(symbol) {
  const settings = loadSettings();
  delete settings.alerts.tokens[symbol.toUpperCase()];
  writeJSON(SETTINGS_PATH, settings);
  return settings;
}

function getMaskedSettings() {
  const settings = loadSettings();
  return {
    ...settings,
    telegram: {
      ...settings.telegram,
      botToken: settings.telegram.botToken
        ? settings.telegram.botToken.slice(0, 6) + '...' + settings.telegram.botToken.slice(-4)
        : '',
    },
    discord: {
      ...settings.discord,
      webhookUrl: settings.discord.webhookUrl
        ? settings.discord.webhookUrl.replace(/\/[^/]+$/, '/***')
        : '',
    },
  };
}

module.exports = {
  loadSettings,
  saveSettings,
  getAlertConfig,
  setTokenAlerts,
  removeTokenAlerts,
  getMaskedSettings,
};
