import { useState, useEffect } from 'react';
import { useAuthAPI, getAuthHeaders } from '../hooks/useAPI';
import Loading from '../components/Loading';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await useAuthAPI('/api/settings');
      setSettings(data);
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <Loading text="Cargando configuracion..." />;
  if (!settings) return <div className="history-empty">Error cargando configuracion</div>;

  return (
    <div>
      {msg && <MsgBanner msg={msg} onDismiss={() => setMsg(null)} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <TelegramSection settings={settings} onUpdate={load} onMsg={setMsg} />
        <DiscordSection settings={settings} onUpdate={load} onMsg={setMsg} />
      </div>

      <GenericAlertsSection settings={settings} onUpdate={load} onMsg={setMsg} />
      <TokenAlertsSection settings={settings} onUpdate={load} onMsg={setMsg} />
    </div>
  );
}

function MsgBanner({ msg, onDismiss }) {
  return (
    <div style={{
      padding: '0.5rem 1rem', marginBottom: '1rem', borderRadius: 8, fontSize: '0.85rem',
      background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
      border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
      color: msg.type === 'error' ? 'var(--red)' : 'var(--green)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span>{msg.text}</span>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem' }}>&times;</button>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="market-section">
      <h3 className="section-title">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
      <label style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>{label}</label>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        background: checked ? 'var(--blue)' : 'var(--surface2)',
        borderRadius: 22, transition: '0.2s',
      }} />
      <span style={{
        position: 'absolute', height: 16, width: 16, left: checked ? 20 : 4, bottom: 3,
        background: 'white', borderRadius: '50%', transition: '0.2s',
      }} />
    </label>
  );
}

// ============================================================
// Telegram
// ============================================================

function TelegramSection({ settings, onUpdate, onMsg }) {
  const tg = settings.telegram || {};
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(tg.enabled);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEnabled(tg.enabled);
  }, [tg.enabled]);

  async function save() {
    setLoading(true);
    const payload = { telegram: { enabled } };
    if (botToken) payload.telegram.botToken = botToken;
    if (chatId) payload.telegram.chatId = chatId;
    try {
      const res = await fetch('/api/settings', { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) { onMsg({ type: 'ok', text: 'Telegram guardado' }); setBotToken(''); setChatId(''); onUpdate(); }
      else onMsg({ type: 'error', text: data.error || 'Error' });
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  async function test() {
    setLoading(true);
    const payload = {};
    if (botToken) payload.botToken = botToken;
    if (chatId) payload.chatId = chatId;
    try {
      const res = await fetch('/api/settings/test/telegram', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) onMsg({ type: 'ok', text: 'Mensaje de prueba enviado!' });
      else onMsg({ type: 'error', text: data.error || 'Error enviando test' });
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  return (
    <Section title={`Telegram ${tg.enabled && tg.botToken ? '✓' : ''}`}>
      <Row label="Bot Token">
        <input type="password" value={botToken} onChange={e => setBotToken(e.target.value)}
          placeholder={tg.botToken || '123456:ABC-DEF...'} style={{ width: 200 }} />
      </Row>
      <Row label="Chat ID">
        <input type="text" value={chatId} onChange={e => setChatId(e.target.value)}
          placeholder={tg.chatId || '-100123456789'} style={{ width: 200 }} />
      </Row>
      <Row label="Habilitado"><Toggle checked={enabled} onChange={setEnabled} /></Row>
      {tg.envConfigured && (
        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, padding: '0.5rem 0.75rem', margin: '0.75rem 0', fontSize: '0.75rem', color: 'var(--green)' }}>
          Respaldo activo: las alertas tambien se envian al canal del servidor.
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={loading}>Guardar</button>
        <button className="btn btn-secondary btn-sm" onClick={test} disabled={loading}>Enviar Test</button>
      </div>
    </Section>
  );
}

// ============================================================
// Discord
// ============================================================

function DiscordSection({ settings, onUpdate, onMsg }) {
  const dc = settings.discord || {};
  const [webhookUrl, setWebhookUrl] = useState('');
  const [enabled, setEnabled] = useState(dc.enabled);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setEnabled(dc.enabled); }, [dc.enabled]);

  async function save() {
    setLoading(true);
    const payload = { discord: { enabled } };
    if (webhookUrl) payload.discord.webhookUrl = webhookUrl;
    try {
      const res = await fetch('/api/settings', { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) { onMsg({ type: 'ok', text: 'Discord guardado' }); setWebhookUrl(''); onUpdate(); }
      else onMsg({ type: 'error', text: data.error || 'Error' });
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  async function test() {
    setLoading(true);
    const payload = {};
    if (webhookUrl) payload.webhookUrl = webhookUrl;
    try {
      const res = await fetch('/api/settings/test/discord', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();
      if (data.success) onMsg({ type: 'ok', text: 'Mensaje de prueba enviado!' });
      else onMsg({ type: 'error', text: data.error || 'Error enviando test' });
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  return (
    <Section title={`Discord ${dc.enabled && dc.webhookUrl ? '✓' : ''}`}>
      <Row label="Webhook URL">
        <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
          placeholder={dc.webhookUrl || 'https://discord.com/api/webhooks/...'} style={{ width: 250 }} />
      </Row>
      <Row label="Habilitado"><Toggle checked={enabled} onChange={setEnabled} /></Row>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={loading}>Guardar</button>
        <button className="btn btn-secondary btn-sm" onClick={test} disabled={loading}>Enviar Test</button>
      </div>
    </Section>
  );
}

// ============================================================
// Generic Alerts
// ============================================================

function GenericAlertsSection({ settings, onUpdate, onMsg }) {
  const ga = settings.alerts?.generic || {};
  const [oversold, setOversold] = useState(ga.rsiOversold);
  const [overbought, setOverbought] = useState(ga.rsiOverbought);
  const [divBull, setDivBull] = useState(ga.divergenceBullish);
  const [divBear, setDivBear] = useState(ga.divergenceBearish);
  const [sentiment, setSentiment] = useState(ga.sentimentExtreme);
  const [cooldown, setCooldown] = useState(ga.cooldownMinutes);
  const [alertTf, setAlertTf] = useState(ga.alertTimeframe || '1d');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const g = settings.alerts?.generic || {};
    setOversold(g.rsiOversold);
    setOverbought(g.rsiOverbought);
    setDivBull(g.divergenceBullish);
    setDivBear(g.divergenceBearish);
    setSentiment(g.sentimentExtreme);
    setCooldown(g.cooldownMinutes);
    setAlertTf(g.alertTimeframe || '1d');
  }, [settings]);

  async function save() {
    setLoading(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: getAuthHeaders(),
        body: JSON.stringify({ alerts: { generic: { rsiOversold: oversold, rsiOverbought: overbought, divergenceBullish: divBull, divergenceBearish: divBear, sentimentExtreme: sentiment, cooldownMinutes: cooldown, alertTimeframe: alertTf } } }),
      });
      const data = await res.json();
      if (data.success) { onMsg({ type: 'ok', text: 'Alertas genericas guardadas' }); onUpdate(); }
      else onMsg({ type: 'error', text: data.error || 'Error' });
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  return (
    <Section title="Alertas Genericas">
      <p className="section-desc">Reglas aplicadas a todos los tokens por defecto. Los tokens con reglas individuales usan las suyas propias.</p>

      <Row label="Intervalo de velas">
        <select value={alertTf} onChange={e => setAlertTf(e.target.value)}>
          <option value="15m">15 min</option>
          <option value="1h">1 hora</option>
          <option value="4h">4 horas</option>
          <option value="1d">1 dia</option>
        </select>
      </Row>
      <Row label={`RSI Sobreventa: ${oversold}`}>
        <input type="range" min="10" max="45" step="1" value={oversold} onChange={e => setOversold(parseInt(e.target.value))}
          style={{ width: 150 }} />
      </Row>
      <Row label={`RSI Sobrecompra: ${overbought}`}>
        <input type="range" min="55" max="90" step="1" value={overbought} onChange={e => setOverbought(parseInt(e.target.value))}
          style={{ width: 150 }} />
      </Row>
      <Row label="Div. Alcista"><Toggle checked={divBull} onChange={setDivBull} /></Row>
      <Row label="Div. Bajista"><Toggle checked={divBear} onChange={setDivBear} /></Row>
      <Row label="Sentimiento Extremo"><Toggle checked={sentiment} onChange={setSentiment} /></Row>
      <Row label="Cooldown">
        <select value={cooldown} onChange={e => setCooldown(parseInt(e.target.value))}>
          <option value="60">1 hora</option>
          <option value="120">2 horas</option>
          <option value="240">4 horas</option>
          <option value="480">8 horas</option>
          <option value="1440">24 horas</option>
        </select>
      </Row>
      <button className="btn btn-primary btn-sm" onClick={save} disabled={loading} style={{ marginTop: '0.5rem' }}>
        Guardar Alertas Genericas
      </button>
    </Section>
  );
}

// ============================================================
// Per-Token Alerts
// ============================================================

function TokenAlertsSection({ settings, onUpdate, onMsg }) {
  const [tokens, setTokens] = useState([]);

  useEffect(() => {
    fetch('/api/tokens').then(r => r.json()).then(setTokens).catch(() => {});
  }, [settings]);

  const tokenAlerts = settings.alerts?.tokens || {};
  const generic = settings.alerts?.generic || {};

  if (tokens.length === 0) {
    return (
      <Section title="Alertas por Token">
        <div className="history-empty">No hay tokens trackeados. Anade tokens desde el Dashboard.</div>
      </Section>
    );
  }

  return (
    <Section title="Alertas por Token">
      <p className="section-desc">Configura reglas individuales para tokens especificos. Estas tienen prioridad sobre las genericas.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
        {tokens.map(t => (
          <TokenAlertRow key={t.symbol} symbol={t.symbol} custom={tokenAlerts[t.symbol]} generic={generic}
            onUpdate={onUpdate} onMsg={onMsg} />
        ))}
      </div>
    </Section>
  );
}

function TokenAlertRow({ symbol, custom, generic, onUpdate, onMsg }) {
  const hasCustom = !!custom;
  const cfg = hasCustom ? { ...generic, ...custom } : generic;
  const [expanded, setExpanded] = useState(hasCustom);
  const [oversold, setOversold] = useState(cfg.rsiOversold);
  const [overbought, setOverbought] = useState(cfg.rsiOverbought);
  const [divBull, setDivBull] = useState(cfg.divergenceBullish);
  const [divBear, setDivBear] = useState(cfg.divergenceBearish);
  const [alertTf, setAlertTf] = useState(cfg.alertTimeframe || '1d');
  const [loading, setLoading] = useState(false);

  async function enable() {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/alerts/${symbol}`, {
        method: 'PUT', headers: getAuthHeaders(),
        body: JSON.stringify({ rsiOversold: generic.rsiOversold, rsiOverbought: generic.rsiOverbought, divergenceBullish: generic.divergenceBullish, divergenceBearish: generic.divergenceBearish, alertTimeframe: generic.alertTimeframe || '1d' }),
      });
      const data = await res.json();
      if (data.success) { setExpanded(true); onUpdate(); }
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  async function save() {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/alerts/${symbol}`, {
        method: 'PUT', headers: getAuthHeaders(),
        body: JSON.stringify({ rsiOversold: oversold, rsiOverbought: overbought, divergenceBullish: divBull, divergenceBearish: divBear, alertTimeframe: alertTf }),
      });
      const data = await res.json();
      if (data.success) { onMsg({ type: 'ok', text: `${symbol} guardado` }); onUpdate(); }
      else onMsg({ type: 'error', text: data.error || 'Error' });
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  async function reset() {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/alerts/${symbol}`, {
        method: 'DELETE', headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) { setExpanded(false); onUpdate(); }
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--surface2)', borderRadius: 8, padding: '0.75rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <strong style={{ fontSize: '0.9rem' }}>{symbol}</strong>
          {hasCustom
            ? <span style={{ color: 'var(--blue)', fontSize: '0.7rem' }}>Personalizado</span>
            : <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>Usando genericas</span>
          }
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Toggle checked={expanded} onChange={v => v ? enable() : reset()} />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Custom</span>
          {hasCustom && <button className="btn btn-sm" style={{ color: 'var(--red)', background: 'rgba(239,68,68,0.1)', fontSize: '0.7rem' }} onClick={reset}>Reset</button>}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--surface2)' }}>
          <Row label="Intervalo de velas">
            <select value={alertTf} onChange={e => setAlertTf(e.target.value)}>
              <option value="15m">15 min</option>
              <option value="1h">1 hora</option>
              <option value="4h">4 horas</option>
              <option value="1d">1 dia</option>
            </select>
          </Row>
          <Row label={`Sobreventa: ${oversold}`}>
            <input type="range" min="10" max="45" step="1" value={oversold} onChange={e => setOversold(parseInt(e.target.value))} style={{ width: 130 }} />
          </Row>
          <Row label={`Sobrecompra: ${overbought}`}>
            <input type="range" min="55" max="90" step="1" value={overbought} onChange={e => setOverbought(parseInt(e.target.value))} style={{ width: 130 }} />
          </Row>
          <Row label="Div. Alcista"><Toggle checked={divBull} onChange={setDivBull} /></Row>
          <Row label="Div. Bajista"><Toggle checked={divBear} onChange={setDivBear} /></Row>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={loading} style={{ marginTop: '0.5rem' }}>Guardar</button>
        </div>
      )}
    </div>
  );
}
