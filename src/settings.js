/**
 * Settings Store — SQLite-backed persistent configuration
 */

const { getDb } = require('./db');

const DEFAULT_SIM_TF = { enabled: false, rsiOversold: 30, rsiOverbought: 70 };

const DEFAULT_SEGURO = {
  logic: 'AND',
  conditions: [
    { field: 'price', op: '<=', target: 'sma200_1h', mult: 0.995, enabled: true },
    { field: 'price', op: '>=', target: 'sma200_4h', mult: 0.9575, enabled: true },
  ],
  filterEntries: false,
  filterAction: 'skip',
};

const DEFAULT_SETTINGS = {
  timezone: 'Europe/Madrid',
  telegram: {
    botToken: '',
    chatId: '',
    enabled: false,
  },
  discord: {
    webhookUrl: '',
    enabled: false,
  },
  seguro: { ...DEFAULT_SEGURO, conditions: DEFAULT_SEGURO.conditions.map(c => ({ ...c })) },
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
    feePercent: 0,
    allowMultiple: false,
    cooldownMinutes: 0,
    timeframes: {
      '15m': { ...DEFAULT_SIM_TF },
      '1h':  { ...DEFAULT_SIM_TF, enabled: true },
      '4h':  { ...DEFAULT_SIM_TF },
      '1d':  { ...DEFAULT_SIM_TF },
    },
  },
};

function _normalizeSeguro(seguro, entryFilter) {
  // Already in new format
  if (seguro?.conditions) {
    return {
      logic: seguro.logic ?? 'AND',
      conditions: seguro.conditions,
      filterEntries: seguro.filterEntries ?? false,
      filterAction: seguro.filterAction ?? 'skip',
    };
  }
  // Old format (mult1h/mult4h): convert to conditions
  const mult1h = seguro?.mult1h ?? 0.995;
  const mult4h = seguro?.mult4h ?? 0.9575;
  return {
    logic: 'AND',
    conditions: [
      { field: 'price', op: '<=', target: 'sma200_1h', mult: mult1h, enabled: true },
      { field: 'price', op: '>=', target: 'sma200_4h', mult: mult4h, enabled: true },
    ],
    filterEntries: entryFilter?.enabled ?? false,
    filterAction: entryFilter?.action ?? 'skip',
  };
}

function _mergeSimTimeframes(userTf) {
  const defaults = DEFAULT_SETTINGS.simulation.timeframes;
  const result = {};
  for (const tf of ['15m', '1h', '4h', '1d']) {
    result[tf] = { ...defaults[tf], ...((userTf || {})[tf] || {}) };
  }
  return result;
}

function _mergeWithDefaults(settings) {
  if (!settings) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    timezone: settings.timezone || 'Europe/Madrid',
    telegram: { ...DEFAULT_SETTINGS.telegram, ...(settings.telegram || {}) },
    discord: { ...DEFAULT_SETTINGS.discord, ...(settings.discord || {}) },
    seguro: _normalizeSeguro(settings.seguro, settings.entryFilter),
    alerts: {
      generic: { ...DEFAULT_SETTINGS.alerts.generic, ...((settings.alerts || {}).generic || {}) },
      tokens: { ...((settings.alerts || {}).tokens || {}) },
    },
    simulation: {
      enabled: settings.simulation?.enabled ?? DEFAULT_SETTINGS.simulation.enabled,
      amount: settings.simulation?.amount ?? DEFAULT_SETTINGS.simulation.amount,
      feePercent: settings.simulation?.feePercent ?? DEFAULT_SETTINGS.simulation.feePercent,
      allowMultiple: settings.simulation?.allowMultiple ?? DEFAULT_SETTINGS.simulation.allowMultiple,
      cooldownMinutes: settings.simulation?.cooldownMinutes ?? DEFAULT_SETTINGS.simulation.cooldownMinutes,
      timeframes: _mergeSimTimeframes(settings.simulation?.timeframes),
    },
  };
}

function _readRaw() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('main');
  return row ? JSON.parse(row.value) : null;
}

function _writeRaw(settings) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('main', JSON.stringify(settings));
}

function loadSettings() {
  const raw = _readRaw();
  if (!raw) {
    _writeRaw(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  return _mergeWithDefaults(raw);
}

function saveSettings(updates) {
  const raw = _readRaw();
  const current = _mergeWithDefaults(raw);
  const seguro = updates.seguro ? _normalizeSeguro(updates.seguro) : current.seguro;
  const merged = {
    timezone: updates.timezone ?? current.timezone ?? 'Europe/Madrid',
    telegram: { ...current.telegram, ...(updates.telegram || {}) },
    discord: { ...current.discord, ...(updates.discord || {}) },
    seguro,
    alerts: {
      generic: { ...current.alerts.generic, ...((updates.alerts || {}).generic || {}) },
      tokens: { ...current.alerts.tokens, ...((updates.alerts || {}).tokens || {}) },
    },
    simulation: {
      enabled: updates.simulation?.enabled ?? current.simulation?.enabled ?? true,
      amount: updates.simulation?.amount ?? current.simulation?.amount ?? 1000,
      feePercent: updates.simulation?.feePercent ?? current.simulation?.feePercent ?? 0,
      allowMultiple: updates.simulation?.allowMultiple ?? current.simulation?.allowMultiple ?? false,
      cooldownMinutes: updates.simulation?.cooldownMinutes ?? current.simulation?.cooldownMinutes ?? 0,
      timeframes: _mergeSimTimeframes({
        ...current.simulation?.timeframes,
        ...updates.simulation?.timeframes,
      }),
    },
  };
  _writeRaw(merged);
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
  _writeRaw(settings);
  return settings;
}

function removeTokenAlerts(symbol) {
  const settings = loadSettings();
  delete settings.alerts.tokens[symbol.toUpperCase()];
  _writeRaw(settings);
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
  loadSettings, saveSettings, getAlertConfig, setTokenAlerts,
  removeTokenAlerts, getMaskedSettings, getSimulationConfig, saveSimulationConfig,
};
