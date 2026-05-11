/**
 * Settings Routes — Configuration, alerts, simulation
 */

const { Router } = require('express');
const { authMiddleware, adminMiddleware } = require('../auth');
const {
  loadSettings, saveSettings, getAlertConfig, setTokenAlerts,
  removeTokenAlerts, getMaskedSettings, getSimulationConfig, saveSimulationConfig,
} = require('../settings');
const { sendTelegramMessage } = require('../telegram');
const { sendDiscordMessage } = require('../discord');

const router = Router();

router.get('/settings', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getMaskedSettings());
});

router.put('/settings', authMiddleware, adminMiddleware, (req, res) => {
  const updated = saveSettings(req.body);
  res.json({ success: true, settings: updated });
});

router.post('/settings/test/telegram', authMiddleware, adminMiddleware, async (req, res) => {
  const { chatId, botToken } = req.body;
  const currentSettings = loadSettings();
  const token = botToken || currentSettings.telegram.botToken;
  const chat = chatId || currentSettings.telegram.chatId;

  if (!token || !chat) {
    return res.status(400).json({ error: 'Configura Bot Token y Chat ID primero' });
  }

  const sent = await sendTelegramMessage('✅ Test desde CryptoRSI - Telegram configurado correctamente!', chat, token);
  if (sent) {
    res.json({ success: true, message: 'Mensaje de prueba enviado' });
  } else {
    res.status(500).json({ error: 'Error enviando mensaje. Verifica el token y chat ID.' });
  }
});

router.post('/settings/test/discord', authMiddleware, adminMiddleware, async (req, res) => {
  const { webhookUrl } = req.body;
  const url = webhookUrl || loadSettings().discord.webhookUrl;

  if (!url) {
    return res.status(400).json({ error: 'Configura el Webhook URL primero' });
  }

  const sent = await sendDiscordMessage('✅ Test desde CryptoRSI - Discord configurado correctamente!', url);
  if (sent) {
    res.json({ success: true, message: 'Mensaje de prueba enviado' });
  } else {
    res.status(500).json({ error: 'Error enviando mensaje. Verifica el Webhook URL.' });
  }
});

router.get('/settings/alerts/:symbol', authMiddleware, adminMiddleware, (req, res) => {
  const config = getAlertConfig(req.params.symbol);
  res.json(config);
});

router.put('/settings/alerts/:symbol', authMiddleware, adminMiddleware, (req, res) => {
  const result = setTokenAlerts(req.params.symbol, req.body);
  res.json({ success: true, settings: result });
});

router.delete('/settings/alerts/:symbol', authMiddleware, adminMiddleware, (req, res) => {
  const result = removeTokenAlerts(req.params.symbol);
  res.json({ success: true, settings: result });
});

router.get('/settings/simulation', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getSimulationConfig());
});

router.put('/settings/simulation', authMiddleware, adminMiddleware, (req, res) => {
  const updated = saveSimulationConfig(req.body);
  res.json({ success: true, simulation: updated.simulation });
});

module.exports = router;
