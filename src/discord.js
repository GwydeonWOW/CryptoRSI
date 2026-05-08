/**
 * Discord Webhook Notifications using Rich Embeds
 */

const fetch = require('node-fetch');
const cooldownStore = require('./cooldownStore');

const COLORS = {
  green: 0x22c55e,
  red: 0xef4444,
  orange: 0xf97316,
  yellow: 0xeab308,
};

function fmtPrice(v) {
  if (v == null) return '?';
  if (v >= 1) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 0.01) return '$' + v.toFixed(4);
  return '$' + v.toFixed(8);
}

const RSI_EMOJI = {
  oversold: '🟢',
  overbought: '🔴',
  bullishDiv: '📈',
  bearishDiv: '📉',
};

async function sendDiscordEmbed(embed, webhookUrl) {
  if (!webhookUrl) return false;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '@everyone', embeds: [embed] }),
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

async function sendDiscordMessage(text, webhookUrl) {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) return false;
    return true;
  } catch (e) {
    console.error('Discord send error:', e.message);
    return false;
  }
}

function buildTimeframeField(rsi15m, rsi1h, rsi4h, rsi1d) {
  return `\`\`\`\n15m   ${pad(rsi15m)}  |  1H   ${pad(rsi1h)}  |  4H   ${pad(rsi4h)}  |  1D   ${pad(rsi1d)}\n\`\`\``;
}

function pad(v) {
  if (v === null || v === undefined) return '  -  ';
  return v.toFixed(1).padStart(5);
}

function buildBaseEmbed(token, alertRSI, alertTf) {
  const priceStr = fmtPrice(token.price);
  return {
    title: `${token.name || token.symbol} (${token.symbol})`,
    url: `https://www.binance.com/en/trade/${token.symbol}_USDT`,
    fields: [
      { name: 'RSI', value: `**${alertRSI.toFixed(1)}** (${alertTf})`, inline: true },
      { name: 'Precio', value: priceStr, inline: true },
    ],
    footer: { text: 'CryptoRSI', icon_url: 'https://cdn.discordapp.com/embed/avatars/0.png' },
    timestamp: new Date().toISOString(),
  };
}

async function checkAndNotifyDiscord(rsiDataArray, settings) {
  const { webhookUrl, enabled } = settings.discord || {};
  if (!enabled || !webhookUrl) {
    console.log('  [DC-ALERT] SKIPPED: discord not configured (enabled=' + enabled + ')');
    return;
  }

  const alertGeneric = settings.alerts?.generic || {};
  const tokenAlerts = settings.alerts?.tokens || {};
  const cooldownMs = (alertGeneric.cooldownMinutes || 240) * 60 * 1000;
  const now = Date.now();
  const alertTf = alertGeneric.alertTimeframe || '1d';

  console.log(`  [DC-ALERT] Checking ${rsiDataArray.length} tokens | TF: ${alertTf} | Oversold: <=${alertGeneric.rsiOversold || 30}`);

  for (const token of rsiDataArray) {
    if (!token.primaryRSI || !token.recommendation) continue;

    const { symbol, name } = token;
    const divergence = token.divergence;
    const rsi1d = token.timeframes?.['1d']?.rsi;
    const rsi4h = token.timeframes?.['4h']?.rsi;
    const rsi1h = token.timeframes?.['1h']?.rsi;
    const rsi15m = token.timeframes?.['15m']?.rsi;

    const alertConfig = { ...alertGeneric, ...(tokenAlerts[symbol] || {}) };
    const alertTf = alertConfig.alertTimeframe || '1d';
    const alertRSI = token.timeframes?.[alertTf]?.rsi || token.primaryRSI;
    const tfField = buildTimeframeField(rsi15m, rsi1h, rsi4h, rsi1d);

    const sma200 = token.sma200;
    const sma200Field = sma200 ? {
      name: 'SMA 200',
      value: `**${fmtPrice(sma200)}** ${token.price >= sma200 ? '📈 Encima' : '📉 Debajo'}`,
      inline: true,
    } : null;

    // Bullish divergence
    if (alertConfig.divergenceBullish && divergence?.bullish && alertRSI <= 40) {
      const key = `discord_bull:${symbol}`;
      const lastSent = cooldownStore.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {

        const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
        const embed = {
          ...buildBaseEmbed(token, alertRSI, alertTf),
          color: COLORS.green,
          author: { name: `${RSI_EMOJI.bullishDiv} DIVERGENCIA ALCISTA` },
          description: `${divergence.reason || 'Precio baja pero RSI sube'}\nFuerza: **${strengthLabel}**`,
          fields: [
            ...buildBaseEmbed(token, alertRSI, alertTf).fields,
            sma200Field,
            { name: 'RSI por timeframe', value: tfField, inline: false },
            { name: 'Senal', value: 'Compra: la presion vendedora se debilita. Posible rebote alcista.', inline: false },
          ].filter(Boolean),
        };

        const sent = await sendDiscordEmbed(embed, webhookUrl);
        if (sent) cooldownStore.set(key, now);
      }
    }

    // Bearish divergence
    if (alertConfig.divergenceBearish && divergence?.bearish && alertRSI >= 60) {
      const key = `discord_bear:${symbol}`;
      const lastSent = cooldownStore.get(key);
      if (!(lastSent && now - lastSent < cooldownMs)) {

        const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
        const embed = {
          ...buildBaseEmbed(token, alertRSI, alertTf),
          color: COLORS.red,
          author: { name: `${RSI_EMOJI.bearishDiv} DIVERGENCIA BAJISTA` },
          description: `${divergence.reason || 'Precio sube pero RSI baja'}\nFuerza: **${strengthLabel}**`,
          fields: [
            ...buildBaseEmbed(token, alertRSI, alertTf).fields,
            sma200Field,
            { name: 'RSI por timeframe', value: tfField, inline: false },
            { name: 'Senal', value: 'Venta: la presion compradora se debilita. Posible correccion bajista.', inline: false },
          ].filter(Boolean),
        };

        const sent = await sendDiscordEmbed(embed, webhookUrl);
        if (sent) cooldownStore.set(key, now);
      }
    }

    // RSI Oversold
    if (alertRSI <= alertConfig.rsiOversold) {
      const key = `discord_buy:${symbol}`;
      const lastSent = cooldownStore.get(key);
      const blocked = lastSent && now - lastSent < cooldownMs;
      console.log(`  [DC-ALERT] OVERSOLD ${symbol} | RSI ${alertRSI.toFixed(1)} (${alertTf}) | blocked=${blocked}${blocked ? ` (${Math.round((cooldownMs - (now - lastSent)) / 60000)}min left)` : ''}`);
      if (!blocked) {

        const embed = {
          ...buildBaseEmbed(token, alertRSI, alertTf),
          color: COLORS.green,
          author: { name: `${RSI_EMOJI.oversold} SOBREVENTA` },
          description: `RSI en zona de sobreventa (<=${alertConfig.rsiOversold}).`,
          fields: [
            ...buildBaseEmbed(token, alertRSI, alertTf).fields,
            sma200Field,
            { name: 'RSI por timeframe', value: tfField, inline: false },
          ].filter(Boolean),
        };

        const sent = await sendDiscordEmbed(embed, webhookUrl);
        if (sent) cooldownStore.set(key, now);
      }
    }

    // RSI Overbought
    if (alertRSI >= alertConfig.rsiOverbought) {
      const key = `discord_sell:${symbol}`;
      const lastSent = cooldownStore.get(key);
      const blocked = lastSent && now - lastSent < cooldownMs;
      console.log(`  [DC-ALERT] OVERBOUGHT ${symbol} | RSI ${alertRSI.toFixed(1)} (${alertTf}) | blocked=${blocked}${blocked ? ` (${Math.round((cooldownMs - (now - lastSent)) / 60000)}min left)` : ''}`);
      if (!blocked) {

        const embed = {
          ...buildBaseEmbed(token, alertRSI, alertTf),
          color: COLORS.red,
          author: { name: `${RSI_EMOJI.overbought} SOBRECOMPRA` },
          description: `RSI en zona de sobrecompra (>=${alertConfig.rsiOverbought}).`,
          fields: [
            ...buildBaseEmbed(token, alertRSI, alertTf).fields,
            sma200Field,
            { name: 'RSI por timeframe', value: tfField, inline: false },
          ].filter(Boolean),
        };

        const sent = await sendDiscordEmbed(embed, webhookUrl);
        if (sent) cooldownStore.set(key, now);
      }
    }
  }
}

// ============================================================
// Single alert sender (no cooldown logic — managed by dispatcher)
// ============================================================

async function sendAlert(type, token, alertRSI, alertTf, alertConfig, webhookUrl) {
  const { symbol } = token;
  const divergence = token.divergence;
  const rsi1d = token.timeframes?.['1d']?.rsi;
  const rsi4h = token.timeframes?.['4h']?.rsi;
  const rsi1h = token.timeframes?.['1h']?.rsi;
  const rsi15m = token.timeframes?.['15m']?.rsi;
  const tfField = buildTimeframeField(rsi15m, rsi1h, rsi4h, rsi1d);

  const sma200 = token.sma200;
  const sma200Field = sma200 ? {
    name: 'SMA 200',
    value: `**${fmtPrice(sma200)}** ${token.price >= sma200 ? '📈 Encima' : '📉 Debajo'}`,
    inline: true,
  } : null;

  let embed;

  if (type === 'bull') {
    const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
    embed = {
      ...buildBaseEmbed(token, alertRSI, alertTf),
      color: COLORS.green,
      author: { name: `${RSI_EMOJI.bullishDiv} DIVERGENCIA ALCISTA` },
      description: `${divergence.reason || 'Precio baja pero RSI sube'}\nFuerza: **${strengthLabel}**`,
      fields: [
        ...buildBaseEmbed(token, alertRSI, alertTf).fields,
        sma200Field,
        { name: 'RSI por timeframe', value: tfField, inline: false },
        { name: 'Senal', value: 'Compra: la presion vendedora se debilita. Posible rebote alcista.', inline: false },
      ].filter(Boolean),
    };
  } else if (type === 'bear') {
    const strengthLabel = divergence.strength === 'strong' ? 'FUERTE' : divergence.strength === 'normal' ? 'Normal' : 'Debil';
    embed = {
      ...buildBaseEmbed(token, alertRSI, alertTf),
      color: COLORS.red,
      author: { name: `${RSI_EMOJI.bearishDiv} DIVERGENCIA BAJISTA` },
      description: `${divergence.reason || 'Precio sube pero RSI baja'}\nFuerza: **${strengthLabel}**`,
      fields: [
        ...buildBaseEmbed(token, alertRSI, alertTf).fields,
        sma200Field,
        { name: 'RSI por timeframe', value: tfField, inline: false },
        { name: 'Senal', value: 'Venta: la presion compradora se debilita. Posible correccion bajista.', inline: false },
      ].filter(Boolean),
    };
  } else if (type === 'oversold') {
    embed = {
      ...buildBaseEmbed(token, alertRSI, alertTf),
      color: COLORS.green,
      author: { name: `${RSI_EMOJI.oversold} SOBREVENTA` },
      description: `RSI en zona de sobreventa (<=${alertConfig.rsiOversold || 30}).`,
      fields: [
        ...buildBaseEmbed(token, alertRSI, alertTf).fields,
        sma200Field,
        { name: 'RSI por timeframe', value: tfField, inline: false },
      ].filter(Boolean),
    };
  } else if (type === 'overbought') {
    embed = {
      ...buildBaseEmbed(token, alertRSI, alertTf),
      color: COLORS.red,
      author: { name: `${RSI_EMOJI.overbought} SOBRECOMPRA` },
      description: `RSI en zona de sobrecompra (>=${alertConfig.rsiOverbought || 70}).`,
      fields: [
        ...buildBaseEmbed(token, alertRSI, alertTf).fields,
        sma200Field,
        { name: 'RSI por timeframe', value: tfField, inline: false },
      ].filter(Boolean),
    };
  }

  if (!embed) return false;
  return await sendDiscordEmbed(embed, webhookUrl);
}

module.exports = { sendDiscordMessage, checkAndNotifyDiscord, sendAlert };
