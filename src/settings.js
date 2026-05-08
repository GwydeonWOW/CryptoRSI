/**
 * Settings Store - Persistent configuration for notifications, alerts, and simulation
 */

const path = require('path');
const { getDataDir, ensureDataDir, readJSON, writeJSON } = require('./storage');

const SETTINGS_PATH = path.join(getDataDir(), 'settings.json');

const DEFAULT_SIM_TF = { enabled: false, rsiOversold: 30, rsiOverbought: 70 };

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
  simulation: {
    enabled: true,
    amount: 1000,
    timeframes: {
      '15m': { ...DEFAULT_SIM_TF },
      '1h':  { ...DEFAULT_SIM_TF, enabled: true },
      '4h':  { ...DEFAULT_SIM_TF },
      '1d':  { ...DEFAULT_SIM_TF },
    },
  },
};

function _mergeSimTimeframes(userTf) {
  const result = {};
  for (const tf of ['15m', '1h', '4h', '1d']) {
    result[tf] = { ...DEFAULT_SIM_TF, ...((userTf || {})[tf] || {}) };
  }
  return result;
}

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
    simulation: {
      enabled: settings.simulation?.enabled ?? DEFAULT_SETTINGS.simulation.enabled,
      amount: settings.simulation?.amount ?? DEFAULT_SETTINGS.simulation.amount,
      timeframes: _mergeSimTimeframes(settings.simulation?.timeframes),
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
    simulation: {
      enabled: updates.simulation?.enabled ?? current.simulation?.enabled ?? true,
      amount: updates.simulation?.amount ?? current.simulation?.amount ?? 1000,
      timeframes: _mergeSimTimeframes({
        ...current.simulation?.timeframes,
        ...updates.simulation?.timeframes,
      }),
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

function getSimulationConfig() {
  return loadSettings().simulation;
}

function saveSimulationConfig(updates) {
  return saveSettings({ simulation: updates });
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
      envConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
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
  getSimulationConfig,
  saveSimulationConfig,
};
