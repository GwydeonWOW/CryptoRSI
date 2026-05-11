/**
 * Alert Dispatch Service — Centralized alert queue and multi-channel dispatch
 */

const cooldownStore = require('../cooldownStore');
const { sendAlert: sendTelegramAlert } = require('../telegram');
const { sendAlert: sendDiscordAlert } = require('../discord');

function buildAlertQueue(rsiDataArray, settings) {
  const alertGeneric = settings.alerts?.generic || {};
  const tokenAlerts = settings.alerts?.tokens || {};
  const cooldownMs = (alertGeneric.cooldownMinutes || 240) * 60 * 1000;
  const now = Date.now();

  const queue = [];

  for (const token of rsiDataArray) {
    if (!token.primaryRSI || !token.recommendation) continue;

    const { symbol } = token;
    const divergence = token.divergence;
    const alertConfig = { ...alertGeneric, ...(tokenAlerts[symbol] || {}) };
    const alertTf = alertConfig.alertTimeframe || '1d';
    const alertRSI = token.timeframes?.[alertTf]?.rsi || token.primaryRSI;

    if (alertConfig.divergenceBullish && divergence?.bullish && alertRSI <= 40) {
      const key = `bull:${symbol}`;
      const lastSent = cooldownStore.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {
        queue.push({ type: 'bull', key, token, alertRSI, alertTf, alertConfig });
      }
    }

    if (alertConfig.divergenceBearish && divergence?.bearish && alertRSI >= 60) {
      const key = `bear:${symbol}`;
      const lastSent = cooldownStore.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {
        queue.push({ type: 'bear', key, token, alertRSI, alertTf, alertConfig });
      }
    }

    if (alertRSI <= (alertConfig.rsiOversold || 30)) {
      const key = `buy:${symbol}`;
      const lastSent = cooldownStore.get(key);
      const blocked = lastSent && now - lastSent < cooldownMs;
      console.log(`  [ALERT] OVERSOLD ${symbol} | RSI ${alertRSI.toFixed(1)} (${alertTf}) | blocked=${blocked}${blocked ? ` (${Math.round((cooldownMs - (now - lastSent)) / 60000)}min left)` : ''}`);
      if (!blocked) {
        queue.push({ type: 'oversold', key, token, alertRSI, alertTf, alertConfig });
      }
    }

    if (alertRSI >= (alertConfig.rsiOverbought || 70)) {
      const key = `sell:${symbol}`;
      const lastSent = cooldownStore.get(key);
      const blocked = lastSent && now - lastSent < cooldownMs;
      console.log(`  [ALERT] OVERBOUGHT ${symbol} | RSI ${alertRSI.toFixed(1)} (${alertTf}) | blocked=${blocked}${blocked ? ` (${Math.round((cooldownMs - (now - lastSent)) / 60000)}min left)` : ''}`);
      if (!blocked) {
        queue.push({ type: 'overbought', key, token, alertRSI, alertTf, alertConfig });
      }
    }
  }

  return queue;
}

async function dispatchAlerts(rsiDataArray, settings) {
  const tg = settings.telegram || {};
  const dc = settings.discord || {};
  const tgWebEnabled = tg.enabled && tg.botToken && tg.chatId;
  const tgBackupToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgBackupChatId = process.env.TELEGRAM_CHAT_ID;
  const tgUseBackup = !!(tgBackupToken && tgBackupChatId);
  const dcEnabled = dc.enabled && dc.webhookUrl;

  if (!tgWebEnabled && !tgUseBackup && !dcEnabled) {
    console.log('  [ALERT] SKIPPED: no channel configured');
    return;
  }

  const queue = buildAlertQueue(rsiDataArray, settings);
  if (queue.length === 0) return;

  console.log(`  [ALERT] Dispatching ${queue.length} alerts (TG: ${tgWebEnabled || tgUseBackup}, DC: ${dcEnabled})`);

  for (const alert of queue) {
    let anySent = false;
    const { type, key, token, alertRSI, alertTf, alertConfig } = alert;

    if (tgWebEnabled) {
      const sent = await sendTelegramAlert(type, token, alertRSI, alertTf, alertConfig, tg.chatId, tg.botToken);
      if (sent) anySent = true;
    }
    if (tgUseBackup) {
      const sent = await sendTelegramAlert(type, token, alertRSI, alertTf, alertConfig, tgBackupChatId, tgBackupToken);
      if (sent) anySent = true;
    }

    if (dcEnabled) {
      const sent = await sendDiscordAlert(type, token, alertRSI, alertTf, alertConfig, dc.webhookUrl);
      if (sent) anySent = true;
    }

    if (anySent) {
      cooldownStore.set(key, Date.now());
      console.log(`  [ALERT] SENT ${type} ${token.symbol} | RSI ${alertRSI.toFixed(1)} (${alertTf})`);
    } else {
      console.log(`  [ALERT] FAILED ${type} ${token.symbol} | all channels failed — cooldown NOT set (will retry next tick)`);
    }
  }
}

module.exports = { buildAlertQueue, dispatchAlerts };
