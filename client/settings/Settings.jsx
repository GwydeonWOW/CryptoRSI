import { useState, useEffect } from 'react';
import { useAuthAPI, getAuthHeaders } from '../hooks/useAPI';
import { useTimezone } from '../hooks/useTimezone';
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

      <TimezoneSection settings={settings} onUpdate={load} onMsg={setMsg} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <TelegramSection settings={settings} onUpdate={load} onMsg={setMsg} />
        <DiscordSection settings={settings} onUpdate={load} onMsg={setMsg} />
      </div>

      <GenericAlertsSection settings={settings} onUpdate={load} onMsg={setMsg} />
      <SeguroSection settings={settings} onUpdate={load} onMsg={setMsg} />
      <TokenAlertsSection settings={settings} onUpdate={load} onMsg={setMsg} />
      <SimulationSection settings={settings} onUpdate={load} onMsg={setMsg} />
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
    <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
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
// Timezone
// ============================================================

const TIMEZONES = [
  { value: 'Europe/Madrid', label: 'España (CET/CEST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'Reino Unido (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Europa Central (CET/CEST)' },
  { value: 'America/New_York', label: 'USA Este (EST/EDT)' },
  { value: 'America/Chicago', label: 'USA Central (CST/CDT)' },
  { value: 'America/Denver', label: 'USA Montaña (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'USA Oeste (PST/PDT)' },
  { value: 'Asia/Tokyo', label: 'Japon (JST)' },
  { value: 'Asia/Shanghai', label: 'China (CST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Australia/Sydney', label: 'Australia (AEST/AEDT)' },
];

function TimezoneSection({ settings, onUpdate, onMsg }) {
  const { timezone, setTimezone } = useTimezone();
  const [selected, setSelected] = useState(settings.timezone || timezone);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelected(settings.timezone || timezone);
  }, [settings.timezone, timezone]);

  async function save() {
    setLoading(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: getAuthHeaders(),
        body: JSON.stringify({ timezone: selected }),
      });
      const data = await res.json();
      if (data.success) {
        setTimezone(selected);
        onMsg({ type: 'ok', text: 'Zona horaria guardada' });
        onUpdate();
      } else onMsg({ type: 'error', text: data.error || 'Error' });
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  return (
    <Section title="Zona Horaria">
      <p className="section-desc">Afecta a todas las fechas y horas mostradas en la aplicacion.</p>
      <Row label="Zona horaria">
        <select value={selected} onChange={e => setSelected(e.target.value)} style={{ width: 220 }}>
          {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </select>
      </Row>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
        Hora actual: {new Date().toLocaleString('es-ES', { timeZone: selected, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}
      </div>
      <button className="btn btn-primary btn-sm" onClick={save} disabled={loading} style={{ marginTop: '0.5rem' }}>
        Guardar Zona Horaria
      </button>
    </Section>
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
// Seguro Config — Unified: editable label + optional entry filter
// ============================================================

const FIELD_OPTIONS = [
  { value: 'price', label: 'Precio' },
  { value: 'sma200_1h', label: 'SMA200 1h' },
  { value: 'sma200_4h', label: 'SMA200 4h' },
  { value: 'rsi', label: 'RSI (actual)' },
  { value: 'rsi1h', label: 'RSI 1h' },
  { value: 'rsi4h', label: 'RSI 4h' },
  { value: 'rsi1d', label: 'RSI 1d' },
  { value: 'rsi15m', label: 'RSI 15m' },
];

const TARGET_OPTIONS = [
  ...FIELD_OPTIONS,
  { value: 'value', label: 'Valor fijo' },
];

const OP_OPTIONS = [
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '==', label: '=' },
];

function SeguroSection({ settings, onUpdate, onMsg }) {
  const sg = settings.seguro || {};
  const [logic, setLogic] = useState(sg.logic || 'AND');
  const [conditions, setConditions] = useState(sg.conditions || []);
  const [filterEntries, setFilterEntries] = useState(sg.filterEntries ?? false);
  const [filterAction, setFilterAction] = useState(sg.filterAction || 'skip');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = settings.seguro || {};
    setLogic(s.logic || 'AND');
    setConditions(s.conditions || []);
    setFilterEntries(s.filterEntries ?? false);
    setFilterAction(s.filterAction || 'skip');
  }, [settings]);

  function updateCondition(index, field, value) {
    setConditions(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  }

  function addCondition() {
    setConditions(prev => [...prev, { field: 'price', op: '>=', target: 'sma200_1h', mult: 0.98, enabled: true }]);
  }

  function removeCondition(index) {
    setConditions(prev => prev.filter((_, i) => i !== index));
  }

  async function save() {
    setLoading(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ seguro: { logic, conditions, filterEntries, filterAction } }),
      });
      const data = await res.json();
      if (data.success) { onMsg({ type: 'ok', text: 'Seguro guardado' }); onUpdate(); }
      else onMsg({ type: 'error', text: data.error || 'Error' });
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  const selStyle = { padding: '0.2rem 0.4rem', fontSize: '0.8rem', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--surface2)', borderRadius: 4 };
  const numStyle = { width: 65, padding: '0.2rem 0.3rem', fontSize: '0.8rem', textAlign: 'right', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--surface2)', borderRadius: 4 };

  return (
    <Section title={`Seguro ${filterEntries ? '✓' : ''}`}>
      <p className="section-desc">
        Define las condiciones para etiquetar un trade como "seguro". Opcionalmente, usa las mismas condiciones para filtrar entradas.
      </p>

      <Row label="Logica">
        <select value={logic} onChange={e => setLogic(e.target.value)} style={selStyle}>
          <option value="AND">AND (todas las condiciones)</option>
          <option value="OR">OR (cualquier condicion)</option>
        </select>
      </Row>

      <div style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-dim)' }}>
          Condiciones ({conditions.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {conditions.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg)', padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--surface2)', flexWrap: 'wrap' }}>
              <Toggle checked={c.enabled !== false} onChange={v => updateCondition(i, 'enabled', v)} />
              <select value={c.field} onChange={e => updateCondition(i, 'field', e.target.value)} style={selStyle}>
                {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select value={c.op} onChange={e => updateCondition(i, 'op', e.target.value)} style={selStyle}>
                {OP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select value={c.target || 'value'} onChange={e => updateCondition(i, 'target', e.target.value)} style={selStyle}>
                {TARGET_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {c.target && c.target !== 'value' ? (
                <>&times; <input type="number" step="0.001" value={c.mult ?? 1}
                  onChange={e => updateCondition(i, 'mult', parseFloat(e.target.value) || 1)} style={numStyle} /></>
              ) : (
                <input type="number" step="0.1" value={c.value ?? 0}
                  onChange={e => updateCondition(i, 'value', parseFloat(e.target.value) || 0)} style={numStyle} />
              )}
              <button onClick={() => removeCondition(i)}
                style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}>
                &times;
              </button>
            </div>
          ))}
          <button onClick={addCondition}
            style={{ background: 'var(--surface2)', color: 'var(--text-dim)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem', padding: '0.4rem 0.8rem', alignSelf: 'flex-start' }}>
            + Condicion
          </button>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--surface2)', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-dim)' }}>
          Filtro de entrada
        </div>
        <Row label="Filtrar entradas con seguro">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Toggle checked={filterEntries} onChange={setFilterEntries} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Usar las mismas condiciones para filtrar trades</span>
          </div>
        </Row>
        {filterEntries && (
          <Row label="Accion">
            <select value={filterAction} onChange={e => setFilterAction(e.target.value)} style={selStyle}>
              <option value="skip">Omitir cuando se cumpla (skip)</option>
              <option value="allow">Permitir solo cuando se cumpla (allow)</option>
            </select>
          </Row>
        )}
      </div>

      <button className="btn btn-primary btn-sm" onClick={save} disabled={loading} style={{ marginTop: '0.75rem' }}>
        Guardar Seguro
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

// ============================================================
// Simulation Config
// ============================================================

function SimulationSection({ settings, onUpdate, onMsg }) {
  const sim = settings.simulation || {};
  const [enabled, setEnabled] = useState(sim.enabled ?? true);
  const [amount, setAmount] = useState(sim.amount || 1000);
  const [feePercent, setFeePercent] = useState(sim.feePercent || 0);
  const [allowMultiple, setAllowMultiple] = useState(sim.allowMultiple || false);
  const [cooldownMinutes, setCooldownMinutes] = useState(sim.cooldownMinutes || 0);
  const [tfConfigs, setTfConfigs] = useState(
    sim.timeframes || {
      '15m': { enabled: false, rsiOversold: 30, rsiOverbought: 70 },
      '1h': { enabled: true, rsiOversold: 30, rsiOverbought: 70 },
      '4h': { enabled: false, rsiOversold: 30, rsiOverbought: 70 },
      '1d': { enabled: false, rsiOversold: 30, rsiOverbought: 70 },
    }
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = settings.simulation || {};
    setEnabled(s.enabled ?? true);
    setAmount(s.amount || 1000);
    setFeePercent(s.feePercent || 0);
    setAllowMultiple(s.allowMultiple || false);
    setCooldownMinutes(s.cooldownMinutes || 0);
    setTfConfigs(s.timeframes || tfConfigs);
  }, [settings]);

  function updateTf(tf, field, value) {
    setTfConfigs(prev => ({ ...prev, [tf]: { ...prev[tf], [field]: value } }));
  }

  async function save() {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/simulation', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled, amount, feePercent, allowMultiple, cooldownMinutes: allowMultiple ? cooldownMinutes : 0, timeframes: tfConfigs }),
      });
      const data = await res.json();
      if (data.success) { onMsg({ type: 'ok', text: 'Simulacion guardada' }); onUpdate(); }
      else onMsg({ type: 'error', text: data.error || 'Error' });
    } catch (e) { onMsg({ type: 'error', text: e.message }); }
    finally { setLoading(false); }
  }

  const activeCount = Object.values(tfConfigs).filter(c => c.enabled).length;

  return (
    <Section title={`Simulacion ${sim.enabled ? '✓' : ''}`}>
      <p className="section-desc">Configura el simulador automatico de forma independiente a las alertas. Cada timeframe activo abre/cierra posiciones propias.</p>

      <Row label="Simulacion activa"><Toggle checked={enabled} onChange={setEnabled} /></Row>
      <Row label="Monto por operacion ($)">
        <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))}
          min={100} step={100} style={{ width: 120 }} />
      </Row>
      <Row label="Fee por operacion (%)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="number" min="0" max="10" step="0.001" value={feePercent}
            onChange={e => {
              const v = e.target.value;
              setFeePercent(v === '' ? '' : Math.min(10, Math.max(0, parseFloat(v) || 0)));
            }}
            style={{ width: 80, textAlign: 'right' }} />
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>%</span>
        </div>
      </Row>

      <Row label="Multi-compra">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Toggle checked={allowMultiple} onChange={setAllowMultiple} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Permitir multiples compras por token</span>
        </div>
      </Row>

      {allowMultiple && (
        <Row label="Cooldown entre compras">
          <select value={cooldownMinutes} onChange={e => setCooldownMinutes(parseInt(e.target.value))}>
            <option value="0">Sin cooldown</option>
            <option value="60">1 hora</option>
            <option value="120">2 horas</option>
            <option value="240">4 horas</option>
            <option value="480">8 horas</option>
            <option value="720">12 horas</option>
            <option value="1440">24 horas</option>
          </select>
        </Row>
      )}

      <div style={{ marginTop: '1rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-dim)' }}>
          Timeframes activos: {activeCount}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
          {['15m', '1h', '4h', '1d'].map(tf => (
            <TfSimCard key={tf} tf={tf} config={tfConfigs[tf]} onChange={(f, v) => updateTf(tf, f, v)} />
          ))}
        </div>
      </div>

      <button className="btn btn-primary btn-sm" onClick={save} disabled={loading} style={{ marginTop: '1rem' }}>
        Guardar Configuracion de Simulacion
      </button>
    </Section>
  );
}

function TfSimCard({ tf, config, onChange }) {
  const labels = { '15m': '15 Minutos', '1h': '1 Hora', '4h': '4 Horas', '1d': '1 Dia' };
  return (
    <div style={{
      background: config.enabled ? 'rgba(59,130,246,0.08)' : 'var(--bg)',
      border: `1px solid ${config.enabled ? 'rgba(59,130,246,0.3)' : 'var(--surface2)'}`,
      borderRadius: 8, padding: '0.75rem 1rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: config.enabled ? '0.75rem' : 0 }}>
        <div>
          <strong style={{ fontSize: '0.85rem' }}>{labels[tf]}</strong>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginLeft: 6 }}>({tf})</span>
        </div>
        <Toggle checked={config.enabled} onChange={v => onChange('enabled', v)} />
      </div>
      {config.enabled && (
        <>
          <Row label={`Compra RSI ≤ ${config.rsiOversold}`}>
            <input type="range" min="10" max="45" step="1" value={config.rsiOversold}
              onChange={e => onChange('rsiOversold', parseInt(e.target.value))} style={{ width: 100 }} />
          </Row>
          <Row label={`Venta RSI ≥ ${config.rsiOverbought}`}>
            <input type="range" min="55" max="90" step="1" value={config.rsiOverbought}
              onChange={e => onChange('rsiOverbought', parseInt(e.target.value))} style={{ width: 100 }} />
          </Row>
        </>
      )}
    </div>
  );
}
