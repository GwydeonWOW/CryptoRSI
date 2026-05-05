/**
 * Telegram Bot Notifications + Command Handler
 * Reads botToken and chatId from the settings store (configured via web UI).
 */

const fetch = require('node-fetch');

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

// Track which signals were already sent to avoid spamming
const sentSignals = new Map();

let lastUpdateId = 0;
let pollingActive = false;

async function sendTelegramMessage(text, chatId, botToken) {
  if (!botToken || !chatId) return false;

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) console.error('Telegram error:', data.description);
    return data.ok;
  } catch (e) {
    console.error('Telegram send error:', e.message);
    return false;
  }
}

// ============================================================
// Bot command polling - listens for /rsi command
// ============================================================

function startBotPolling(getRSIForAllTokens, getSettings) {
  if (pollingActive) return;
  pollingActive = true;

  async function poll() {
    const settings = getSettings();
    const botToken = settings?.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = settings?.telegram?.chatId || process.env.TELEGRAM_CHAT_ID;

    if (!botToken) {
      // No token configured, retry later
      setTimeout(poll, 30000);
      return;
    }

    try {
      const res = await fetch(`${TELEGRAM_API_BASE}${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["message"]`);
      const data = await res.json();

      if (!data.ok || !data.result) {
        setTimeout(poll, 5000);
        return;
      }

      for (const update of data.result) {
        lastUpdateId = update.update_id;

        const msg = update.message;
        if (!msg || !msg.text) continue;

        const incomingChatId = msg.chat.id.toString();
        const text = msg.text.trim();

        // /rsi command
        if (text === '/rsi' || text === '/rsi@' + (msg.from?.username || '')) {
          await handleRSICommand(incomingChatId, botToken, getRSIForAllTokens);
        }
      }
    } catch (e) {
      console.error('Telegram poll error:', e.message);
    }

    if (pollingActive) setTimeout(poll, 3000);
  }

  poll();
  console.log('Telegram bot polling started (configured via Settings UI)');
}

async function handleRSICommand(chatId, botToken, getRSIForAllTokens) {
  try {
    const tokens = await getRSIForAllTokens();

    if (!tokens || tokens.length === 0) {
      await sendTelegramMessage('No hay tokens trackeados.', chatId, botToken);
      return;
    }

    let text = '📊 <b>RSI de todos los tokens</b>\n━━━━━━━━━━━━━━━\n\n';

    for (const token of tokens) {
      if (token.error) {
        text += `❌ <b>${token.symbol}</b> — Error: ${token.error}\n\n`;
        continue;
      }

      const rsi = token.primaryRSI;
      let emoji = '⚪';
      if (rsi <= 30) emoji = '🟢';
      else if (rsi >= 70) emoji = '🔴';
      else if (rsi <= 40) emoji = '🟡';
      else if (rsi >= 60) emoji = '🟠';

      const price = token.price?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '?';
      const action = token.recommendation?.action || '-';

      const rsi1d = token.timeframes?.['1d']?.rsi;
      const rsi4h = token.timeframes?.['4h']?.rsi;
      const rsi1h = token.timeframes?.['1h']?.rsi;
      const rsi15m = token.timeframes?.['15m']?.rsi;

      text +=
        `${emoji} <b>${token.name || token.symbol}</b> — $${price}\n` +
        `   RSI: <b>${rsi?.toFixed(1) || '-'}</b> → ${action}\n` +
        `   15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n`;
    }

    text += `🔄 Actualizado: ${new Date().toLocaleString('es-ES')}`;

    if (text.length > 4000) {
      const chunks = splitMessage(text, 4000);
      for (const chunk of chunks) {
        await sendTelegramMessage(chunk, chatId, botToken);
      }
    } else {
      await sendTelegramMessage(text, chatId, botToken);
    }
  } catch (e) {
    await sendTelegramMessage(`Error obteniendo RSI: ${e.message}`, chatId, botToken);
  }
}

function splitMessage(text, maxLen) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    if ((current + '\n' + line).length > maxLen) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ============================================================
// RSI Signal notifications (from scheduler)
// Uses alert config from settings store
// ============================================================

async function checkAndNotify(rsiDataArray, settings) {
  const tg = settings.telegram || {};
  const webEnabled = tg.enabled && tg.botToken && tg.chatId;
  const backupToken = process.env.TELEGRAM_BOT_TOKEN;
  const backupChatId = process.env.TELEGRAM_CHAT_ID;
  const useBackup = !!(backupToken && backupChatId);

  if (!webEnabled && !useBackup) return;

  const alertGeneric = settings.alerts?.generic || {};
  const tokenAlerts = settings.alerts?.tokens || {};
  const cooldownMs = (alertGeneric.cooldownMinutes || 240) * 60 * 1000;
  const now = Date.now();

  for (const token of rsiDataArray) {
    if (!token.primaryRSI || !token.recommendation) continue;

    const { symbol, name, price, recommendation } = token;
    const divergence = token.divergence;
    const rsi1d = token.timeframes?.['1d']?.rsi;
    const rsi4h = token.timeframes?.['4h']?.rsi;
    const rsi1h = token.timeframes?.['1h']?.rsi;
    const rsi15m = token.timeframes?.['15m']?.rsi;
    const priceStr = price?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '?';

    const alertConfig = { ...alertGeneric, ...(tokenAlerts[symbol] || {}) };
    const alertTf = alertConfig.alertTimeframe || '1d';
    const alertRSI = token.timeframes?.[alertTf]?.rsi || token.primaryRSI;

    // Bullish divergence
    if (alertConfig.divergenceBullish && divergence?.bullish && alertRSI <= 40) {
      const key = `bull:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {

        const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
        const text =
          `[BULL] <b>DIVERGENCIA ALCISTA</b> — ${name || symbol}\n\n` +
          `Fuerza: <b>${strengthLabel}</b>\n` +
          `${divergence.reason || 'Precio baja pero RSI sube'}\n\n` +
          `📊 RSI: <b>${alertRSI.toFixed(1)}</b> (${alertTf})\n` +
          `💰 Precio: <b>$${priceStr}</b>\n\n` +
          `RSI por timeframe:\n` +
          `   15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
          `⚡ Señal de compra: la presion vendedora se debilita. Posible rebote alcista.`;

        if (webEnabled) await sendTelegramMessage(text, tg.chatId, tg.botToken);
        if (useBackup) await sendTelegramMessage(text, backupChatId, backupToken);
        sentSignals.set(key, now);
      }
    }

    // Bearish divergence
    if (alertConfig.divergenceBearish && divergence?.bearish && alertRSI >= 60) {
      const key = `bear:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {

        const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
        const text =
          `[BEAR] <b>DIVERGENCIA BAJISTA</b> — ${name || symbol}\n\n` +
          `Fuerza: <b>${strengthLabel}</b>\n` +
          `${divergence.reason || 'Precio sube pero RSI baja'}\n\n` +
          `📊 RSI: <b>${alertRSI.toFixed(1)}</b> (${alertTf})\n` +
          `💰 Precio: <b>$${priceStr}</b>\n\n` +
          `RSI por timeframe:\n` +
          `   15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
          `⚠️ Señal de venta: la presion compradora se debilita. Posible correccion bajista.`;

        if (webEnabled) await sendTelegramMessage(text, tg.chatId, tg.botToken);
        if (useBackup) await sendTelegramMessage(text, backupChatId, backupToken);
        sentSignals.set(key, now);
      }
    }

    // RSI Oversold
    if (alertRSI <= alertConfig.rsiOversold) {
      const key = `buy:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {

        const text =
          `🟢 <b>SOBREVENTA</b> — ${name || symbol}\n\n` +
          `📊 RSI: <b>${alertRSI.toFixed(1)}</b> (${alertTf})\n` +
          `💰 Precio: <b>$${priceStr}</b>\n\n` +
          `⏱ 15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
          `⚡ RSI en zona de sobreventa (≤${alertConfig.rsiOversold}).`;

        if (webEnabled) await sendTelegramMessage(text, tg.chatId, tg.botToken);
        if (useBackup) await sendTelegramMessage(text, backupChatId, backupToken);
        sentSignals.set(key, now);
      }
    }

    // RSI Overbought
    if (alertRSI >= alertConfig.rsiOverbought) {
      const key = `sell:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {

        const text =
          `🔴 <b>SOBRECOMPRA</b> — ${name || symbol}\n\n` +
          `📊 RSI: <b>${alertRSI.toFixed(1)}</b> (${alertTf})\n` +
          `💰 Precio: <b>$${priceStr}</b>\n\n` +
          `⏱ 15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
          `⚠️ RSI en zona de sobrecompra (≥${alertConfig.rsiOverbought}).`;

        if (webEnabled) await sendTelegramMessage(text, tg.chatId, tg.botToken);
        if (useBackup) await sendTelegramMessage(text, backupChatId, backupToken);
        sentSignals.set(key, now);
      }
    }
  }
}

module.exports = { sendTelegramMessage, checkAndNotify, startBotPolling };
