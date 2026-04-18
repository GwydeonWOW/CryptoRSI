/**
 * Telegram Bot Notifications
 */

const fetch = require('node-fetch');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8728037006:AAHaIG7abTWXa_tDeZ2Wse0U0veByBodtf0';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-5194984384';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Track which signals were already sent to avoid spamming
// Key: "buy:BTC" or "sell:ETH", Value: ISO date of last notification
const sentSignals = new Map();
const NOTIFY_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours between repeated signals for same token

async function sendTelegramMessage(text) {
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('Telegram error:', data.description);
    }
    return data.ok;
  } catch (e) {
    console.error('Telegram send error:', e.message);
    return false;
  }
}

/**
 * Check RSI data and send notifications for buy/sell signals
 * @param {Array} rsiDataArray - Array of { symbol, name, price, primaryRSI, recommendation, timeframes }
 */
async function checkAndNotify(rsiDataArray) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  const now = Date.now();

  for (const token of rsiDataArray) {
    if (!token.primaryRSI || !token.recommendation) continue;

    const { symbol, name, price, primaryRSI, recommendation } = token;

    // Buy signal: RSI <= 30
    if (primaryRSI <= 30) {
      const key = `buy:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < NOTIFY_COOLDOWN_MS) continue;

      const rsi1d = token.timeframes?.['1d']?.rsi;
      const rsi4h = token.timeframes?.['4h']?.rsi;
      const rsi1h = token.timeframes?.['1h']?.rsi;

      const text =
        `🟢 <b>SEÑAL DE COMPRA</b> — ${name || symbol}\n\n` +
        `📊 RSI Principal: <b>${primaryRSI.toFixed(1)}</b> (${recommendation.action})\n` +
        `💰 Precio: <b>$${price?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '?'}</b>\n\n` +
        `⏱ RSI por timeframe:\n` +
        `   1D: ${rsi1d?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}\n\n` +
        `⚡ RSI en zona de sobreventa (≤30). Posible oportunidad de compra.`;

      const sent = await sendTelegramMessage(text);
      if (sent) sentSignals.set(key, now);
    }

    // Sell signal: RSI >= 70
    if (primaryRSI >= 70) {
      const key = `sell:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < NOTIFY_COOLDOWN_MS) continue;

      const rsi1d = token.timeframes?.['1d']?.rsi;
      const rsi4h = token.timeframes?.['4h']?.rsi;
      const rsi1h = token.timeframes?.['1h']?.rsi;

      const text =
        `🔴 <b>SEÑAL DE VENTA</b> — ${name || symbol}\n\n` +
        `📊 RSI Principal: <b>${primaryRSI.toFixed(1)}</b> (${recommendation.action})\n` +
        `💰 Precio: <b>$${price?.toLocaleString('en-US', { maximumFractionDigits: 2 }) || '?'}</b>\n\n` +
        `⏱ RSI por timeframe:\n` +
        `   1D: ${rsi1d?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}\n\n` +
        `⚠️ RSI en zona de sobrecompra (≥70). Posible señal de venta.`;

      const sent = await sendTelegramMessage(text);
      if (sent) sentSignals.set(key, now);
    }
  }
}

module.exports = { sendTelegramMessage, checkAndNotify };
