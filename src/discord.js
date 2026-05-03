/**
 * Discord Webhook Notifications
 * Mirrors the Telegram notification pattern using Discord webhooks.
 */

const fetch = require('node-fetch');

// Track which signals were already sent to avoid spamming
const sentSignals = new Map();

async function sendDiscordMessage(text, webhookUrl) {
  if (!webhookUrl) return false;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Discord error:', res.status, body);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Discord send error:', e.message);
    return false;
  }
}

async function checkAndNotifyDiscord(rsiDataArray, settings) {
  const { webhookUrl, enabled } = settings.discord || {};
  if (!enabled || !webhookUrl) return;

  const alertGeneric = settings.alerts?.generic || {};
  const tokenAlerts = settings.alerts?.tokens || {};
  const cooldownMs = (alertGeneric.cooldownMinutes || 240) * 60 * 1000;
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

    // Merge generic + per-token alert config
    const alertConfig = { ...alertGeneric, ...(tokenAlerts[symbol] || {}) };

    // Bullish divergence
    if (alertConfig.divergenceBullish && divergence?.bullish && primaryRSI <= 40) {
      const key = `discord_bull:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < cooldownMs) continue;

      const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
      const text =
        `[BULL] **DIVERGENCIA ALCISTA** — ${name || symbol}\n\n` +
        `Fuerza: **${strengthLabel}**\n` +
        `${divergence.reason || 'Precio baja pero RSI sube'}\n\n` +
        `RSI: **${primaryRSI.toFixed(1)}** (${token.primaryTimeframe || '-'})\n` +
        `Precio: **$${priceStr}**\n\n` +
        `RSI por timeframe:\n` +
        `  15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
        `Senal de compra: la presion vendedora se debilita. Posible rebote alcista.`;

      const sent = await sendDiscordMessage(text, webhookUrl);
      if (sent) sentSignals.set(key, now);
    }

    // Bearish divergence
    if (alertConfig.divergenceBearish && divergence?.bearish && primaryRSI >= 60) {
      const key = `discord_bear:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < cooldownMs) continue;

      const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
      const text =
        `[BEAR] **DIVERGENCIA BAJISTA** — ${name || symbol}\n\n` +
        `Fuerza: **${strengthLabel}**\n` +
        `${divergence.reason || 'Precio sube pero RSI baja'}\n\n` +
        `RSI: **${primaryRSI.toFixed(1)}** (${token.primaryTimeframe || '-'})\n` +
        `Precio: **$${priceStr}**\n\n` +
        `RSI por timeframe:\n` +
        `  15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
        `Senal de venta: la presion compradora se debilita. Posible correccion bajista.`;

      const sent = await sendDiscordMessage(text, webhookUrl);
      if (sent) sentSignals.set(key, now);
    }

    // RSI Oversold (only if no divergence detected)
    if (!divergence?.bullish && !divergence?.bearish && primaryRSI <= alertConfig.rsiOversold) {
      const key = `discord_buy:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < cooldownMs) continue;

      const text =
        `**SOBREVENTA** — ${name || symbol}\n\n` +
        `RSI: **${primaryRSI.toFixed(1)}** (${token.primaryTimeframe || '-'})\n` +
        `Precio: **$${priceStr}**\n\n` +
        `15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
        `RSI en zona de sobreventa (<=${alertConfig.rsiOversold}). Sin divergencia detectada.`;

      const sent = await sendDiscordMessage(text, webhookUrl);
      if (sent) sentSignals.set(key, now);
    }

    // RSI Overbought (only if no divergence detected)
    if (!divergence?.bullish && !divergence?.bearish && primaryRSI >= alertConfig.rsiOverbought) {
      const key = `discord_sell:${symbol}`;
      const lastSent = sentSignals.get(key);
      if (lastSent && now - lastSent < cooldownMs) continue;

      const text =
        `**SOBRECOMPRA** — ${name || symbol}\n\n` +
        `RSI: **${primaryRSI.toFixed(1)}** (${token.primaryTimeframe || '-'})\n` +
        `Precio: **$${priceStr}**\n\n` +
        `15m: ${rsi15m?.toFixed(1) || '-'}  |  1H: ${rsi1h?.toFixed(1) || '-'}  |  4H: ${rsi4h?.toFixed(1) || '-'}  |  1D: ${rsi1d?.toFixed(1) || '-'}\n\n` +
        `RSI en zona de sobrecompra (>=${alertConfig.rsiOverbought}). Sin divergencia detectada.`;

      const sent = await sendDiscordMessage(text, webhookUrl);
      if (sent) sentSignals.set(key, now);
    }
  }
}

module.exports = { sendDiscordMessage, checkAndNotifyDiscord };
