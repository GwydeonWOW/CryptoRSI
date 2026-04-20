/**
 * Telegram Bot Notifications + Command Handler
 */

const fetch = require('node-fetch');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8728037006:AAHaIG7abTWXa_tDeZ2Wse0U0veByBodtf0';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-5194984384';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Track which signals were already sent to avoid spamming
const sentSignals = new Map();
const NOTIFY_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

let lastUpdateId = 0;
let pollingActive = false;

async function sendTelegramMessage(text, chatId) {
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId || CHAT_ID,
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

function startBotPolling(getRSIForAllTokens) {
  if (pollingActive) return;
  pollingActive = true;

  async function poll() {
    try {
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["message"]`);
      const data = await res.json();

      if (!data.ok || !data.result) {
        setTimeout(poll, 5000);
        return;
      }

      for (const update of data.result) {
        lastUpdateId = update.update_id;

        const msg = update.message;
        if (!msg || !msg.text) continue;

        const chatId = msg.chat.id.toString();
        const text = msg.text.trim();

        // /rsi command
        if (text === '/rsi' || text === '/rsi@' + (msg.from?.username || '')) {
          await handleRSICommand(chatId, getRSIForAllTokens);
        }
      }
    } catch (e) {
      console.error('Telegram poll error:', e.message);
    }

    if (pollingActive) setTimeout(poll, 1000);
  }

  poll();
  console.log(`Telegram bot polling started (/rsi command available) | Chat ID: ${CHAT_ID} | Token: ${BOT_TOKEN ? BOT_TOKEN.slice(0, 10) + '...' : 'NOT SET'}`);
}

async function handleRSICommand(chatId, getRSIForAllTokens) {
  try {
    const tokens = await getRSIForAllTokens();

    if (!tokens || tokens.length === 0) {
      await sendTelegramMessage('No hay tokens trackeados.', chatId);
      return;
    }

    let text = '📊 <b>RSI de todos los tokens</b>\n━━━━━━━━━━━━━━━\n\n';

    for (const token of tokens) {
      if (token.error) {
        text += `❌ <b>${token.symbol}</b> — Error: ${token.error}\n\n`;
        continue;
      }

      const rsi = token.primaryRSI;
      let emoji = '⚪'; // neutral
      if (rsi <= 30) emoji = '🟢'; // buy
      else if (rsi >= 70) emoji = '🔴'; // sell
      else if (rsi <= 40) emoji = '🟡'; // approaching buy
      else if (rsi >= 60) emoji = '🟠'; // approaching sell

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

    // Telegram message limit is 4096 chars, split if needed
    if (text.length > 4000) {
      const chunks = splitMessage(text, 4000);
      for (const chunk of chunks) {
        await sendTelegramMessage(chunk, chatId);
      }
    } else {
      await sendTelegramMessage(text, chatId);
    }
  } catch (e) {
    await sendTelegramMessage(`Error obteniendo RSI: ${e.message}`, chatId);
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
// ============================================================

async function checkAndNotify(rsiDataArray) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  const now = Date.now();

  for (const token of rsiDataArray) {
    if (!token.primaryRSI || !token.recommendation) continue;

    const { symbol, name, price, primaryRSI, recommendation } = token;
    const divergence = token.divergence;
    const rsi1d = token.timeframes?.['1d']?.rsi;
    const rsi4h = token.timeframes?.['4h']?.rsi;
    const rsi1h = token.timeframes?.['1h']?.rsi;
    const rsi15m = token.timeframes?.['15m']?.rsi;
    const priceStr = price?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '?';

    // Bullish divergence signal (priority)
    if (divergence?.bullish) {
      const key = `bull:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < NOTIFY_COOLDOWN_MS) continue;

      const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
      const text =
        `[BULL] <b>DIVERGENCIA ALCISTA</b> — ${name || symbol}\n\n` +
        `Fuerza: <b>${strengthLabel}</b>\n` +
        `${divergence.reason || 'Precio baja pero RSI sube'}\n\n` +
        `📊 RSI: <b>${primaryRSI.toFixed(1)}</b> (${token.primaryTimeframe || '-'})\n` +
        `💰 Precio: <b>$${priceStr}</b>\n\n` +
        `RSI por timeframe:\n` +
        `   15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
        `⚡ Señal de compra: la presion vendedora se debilita. Posible rebote alcista.`;

      const sent = await sendTelegramMessage(text);
      if (sent) sentSignals.set(key, now);
    }

    // Bearish divergence signal (priority)
    if (divergence?.bearish) {
      const key = `bear:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < NOTIFY_COOLDOWN_MS) continue;

      const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
      const text =
        `[BEAR] <b>DIVERGENCIA BAJISTA</b> — ${name || symbol}\n\n` +
        `Fuerza: <b>${strengthLabel}</b>\n` +
        `${divergence.reason || 'Precio sube pero RSI baja'}\n\n` +
        `📊 RSI: <b>${primaryRSI.toFixed(1)}</b> (${token.primaryTimeframe || '-'})\n` +
        `💰 Precio: <b>$${priceStr}</b>\n\n` +
        `RSI por timeframe:\n` +
        `   15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
        `⚠️ Señal de venta: la presion compradora se debilita. Posible correccion bajista.`;

      const sent = await sendTelegramMessage(text);
      if (sent) sentSignals.set(key, now);
    }

    // Fallback: classic RSI signals (only if no divergence was detected)
    if (!divergence?.bullish && !divergence?.bearish && primaryRSI <= 30) {
      const key = `buy:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < NOTIFY_COOLDOWN_MS) continue;

      const text =
        `🟢 <b>SOBREVENTA</b> — ${name || symbol}\n\n` +
        `📊 RSI: <b>${primaryRSI.toFixed(1)}</b> (${token.primaryTimeframe || '-'})\n` +
        `💰 Precio: <b>$${priceStr}</b>\n\n` +
        `⏱ 15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
        `⚡ RSI en zona de sobreventa (≤30). Sin divergencia detectada.`;

      const sent = await sendTelegramMessage(text);
      if (sent) sentSignals.set(key, now);
    }

    if (!divergence?.bullish && !divergence?.bearish && primaryRSI >= 70) {
      const key = `sell:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < NOTIFY_COOLDOWN_MS) continue;

      const text =
        `🔴 <b>SOBRECOMPRA</b> — ${name || symbol}\n\n` +
        `📊 RSI: <b>${primaryRSI.toFixed(1)}</b> (${token.primaryTimeframe || '-'})\n` +
        `💰 Precio: <b>$${priceStr}</b>\n\n` +
        `⏱ 15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
        `⚠️ RSI en zona de sobrecompra (≥70). Sin divergencia detectada.`;

      const sent = await sendTelegramMessage(text);
      if (sent) sentSignals.set(key, now);
    }
  }
}

module.exports = { sendTelegramMessage, checkAndNotify, startBotPolling };
