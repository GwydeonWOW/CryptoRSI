import { useState, useEffect } from 'react';
import { getAuthHeaders, useAuthAPI } from '../hooks/useAPI';
import { useToast } from '../hooks/useToast';
import { useTimezone } from '../hooks/useTimezone';
import Loading from '../components/Loading';
import SortableTable from '../components/SortableTable';

const TIMEFRAME_OPTIONS = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hora' },
  { value: '4h', label: '4 horas' },
  { value: '1d', label: '1 dia' },
];

const PRESETS = [
  { label: '1 Semana', days: 7 },
  { label: '2 Semanas', days: 14 },
  { label: '1 Mes', days: 30 },
  { label: '3 Meses', days: 90 },
  { label: '6 Meses', days: 180 },
];

export default function BacktestPage() {
  const { addToast } = useToast();
  const { timezone } = useTimezone();
  const [tokens, setTokens] = useState([]);
  const [defaults, setDefaults] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [seguroOnly, setSeguroOnly] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState([]);

  const now = new Date();
  const [form, setForm] = useState({
    symbol: '',
    timeframe: '1h',
    fromDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
    toDate: now.toISOString().split('T')[0],
    amount: 1000,
    feePercent: 0,
    rsiOversold: 30,
    rsiOverbought: 70,
    allowMultiple: false,
    maxInvestment: 0,
    minDelay: 0,
    maxBuys: 0,
    timeExitHours: 0,
    timeExitRSI: 50,
    compound: { enabled: false, mode: 'level', step: 500 },
    rsiRules: { enabled: false, rules: [] },
  });

  useEffect(() => {
    async function load() {
      try {
        const [tokensData, defaultsData] = await Promise.all([
          useAuthAPI('/api/backtest/tokens'),
          useAuthAPI('/api/backtest/defaults'),
        ]);
        setTokens(tokensData);
        setDefaults(defaultsData);
        if (tokensData.length > 0 && !form.symbol) {
          setForm(f => ({ ...f, symbol: tokensData[0].symbol }));
        }
        if (defaultsData) {
          setForm(f => ({
            ...f,
            amount: defaultsData.amount ?? 1000,
            feePercent: defaultsData.feePercent ?? 0,
          }));
        }
      } catch (e) {
        addToast('error', e.message);
      }
    }
    load();
  }, []);

  function setPreset(days) {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    setForm(f => ({
      ...f,
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
    }));
  }

  function toggleSymbol(sym) {
    setSelectedSymbols(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    );
  }

  function toggleAllSymbols() {
    if (selectedSymbols.length === tokens.length) {
      setSelectedSymbols([]);
    } else {
      setSelectedSymbols(tokens.map(t => t.symbol));
    }
  }

  async function runBacktest() {
    if (multiMode) {
      if (selectedSymbols.length === 0) { addToast('error', 'Selecciona al menos 2 tokens'); return; }
      if (selectedSymbols.length < 2) { addToast('error', 'Selecciona al menos 2 tokens para multi-backtest'); return; }
    } else {
      if (!form.symbol) { addToast('error', 'Selecciona un token'); return; }
    }
    setLoading(true);
    setResult(null);
    setSeguroOnly(false);
    try {
      const [fy, fm, fd] = form.fromDate.split('-').map(Number);
      const [ty, tm, td] = form.toDate.split('-').map(Number);
      const startMs = new Date(fy, fm - 1, fd).getTime();
      const endMs = new Date(ty, tm - 1, td, 23, 59, 59, 999).getTime();

      const body = {
        ...form,
        startMs,
        endMs,
        minDelay: (form.minDelay || 0) * 3600000,
        maxBuys: form.maxBuys || 0,
        timeExitHours: form.timeExitHours || 0,
        timeExitRSI: form.timeExitRSI || 50,
      };

      const endpoint = multiMode ? '/api/backtest/run-multi' : '/api/backtest/run';
      if (multiMode) {
        body.symbols = selectedSymbols;
        delete body.symbol;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { addToast('error', data.error); return; }
      setResult(data);
      if (data.errors?.length > 0) {
        addToast('error', `Algunos tokens fallaron: ${data.errors.map(e => `${e.symbol}: ${e.error}`).join('; ')}`);
      }
    } catch (e) {
      addToast('error', e.message);
    } finally {
      setLoading(false);
    }
  }

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const isMulti = result && result.bySymbol;

  return (
    <div>
      {/* Config Panel */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--surface2)',
        borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem',
      }}>
        <h3 className="section-title" style={{ marginBottom: '1rem' }}>Configuracion del Backtest</h3>

        {/* Mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem', padding: '0.5rem 0.75rem', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--surface2)' }}>
          <button onClick={() => setMultiMode(false)} style={{
            padding: '0.4rem 1rem', borderRadius: 6, fontSize: '0.8rem', fontWeight: multiMode ? 400 : 600,
            background: multiMode ? 'transparent' : 'var(--blue)', color: multiMode ? 'var(--text-dim)' : 'white',
            border: 'none', cursor: 'pointer',
          }}>
            Unico Token
          </button>
          <button onClick={() => setMultiMode(true)} style={{
            padding: '0.4rem 1rem', borderRadius: 6, fontSize: '0.8rem', fontWeight: multiMode ? 600 : 400,
            background: multiMode ? 'var(--blue)' : 'transparent', color: multiMode ? 'white' : 'var(--text-dim)',
            border: 'none', cursor: 'pointer',
          }}>
            Multi Token
          </button>
        </div>

        {/* Token selector */}
        {multiMode ? (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)' }}>
                Tokens ({selectedSymbols.length}/{tokens.length})
              </span>
              <button onClick={toggleAllSymbols} style={{
                fontSize: '0.7rem', padding: '0.15rem 0.5rem', background: 'var(--surface2)',
                border: 'none', borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer',
              }}>
                {selectedSymbols.length === tokens.length ? 'Ninguno' : 'Todos'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {tokens.map(t => {
                const sel = selectedSymbols.includes(t.symbol);
                return (
                  <button key={t.symbol} onClick={() => toggleSymbol(t.symbol)} style={{
                    padding: '0.3rem 0.75rem', borderRadius: 6, fontSize: '0.8rem',
                    background: sel ? 'rgba(59,130,246,0.15)' : 'var(--bg)',
                    border: sel ? '1px solid rgba(59,130,246,0.4)' : '1px solid var(--surface2)',
                    color: sel ? 'var(--blue)' : 'var(--text-dim)', cursor: 'pointer', fontWeight: sel ? 600 : 400,
                  }}>
                    {t.symbol}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
          {!multiMode && (
            <Field label="Token">
              <select value={form.symbol} onChange={e => update('symbol', e.target.value)} style={inputStyle}>
                <option value="">Seleccionar...</option>
                {tokens.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
              </select>
            </Field>
          )}

          <Field label="Timeframe">
            <select value={form.timeframe} onChange={e => update('timeframe', e.target.value)} style={inputStyle}>
              {TIMEFRAME_OPTIONS.map(tf => <option key={tf.value} value={tf.value}>{tf.label}</option>)}
            </select>
          </Field>

          <Field label="Monto ($)">
            <input type="number" value={form.amount} onChange={e => update('amount', Number(e.target.value))}
              min={10} step={100} style={inputStyle} />
          </Field>

          <Field label="Fee (%)">
            <input type="number" value={form.feePercent} onChange={e => update('feePercent', Number(e.target.value))}
              min={0} max={10} step={0.001} style={inputStyle} />
          </Field>

          <Field label="RSI Compra (<=)">
            <input type="number" value={form.rsiOversold} onChange={e => update('rsiOversold', Number(e.target.value))}
              min={1} max={100} step={1} style={inputStyle} />
          </Field>

          <Field label="RSI Venta (>=)">
            <input type="number" value={form.rsiOverbought} onChange={e => update('rsiOverbought', Number(e.target.value))}
              min={1} max={100} step={1} style={inputStyle} />
          </Field>

          <Field label="Multi-compra">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <input type="checkbox" checked={form.allowMultiple} onChange={e => update('allowMultiple', e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--blue)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Permitir multiples compras</span>
            </div>
          </Field>

          <Field label={multiMode ? 'Inversion Max Total ($)' : 'Inversion Max ($)'}>
            <input type="number" value={form.maxInvestment || ''} onChange={e => update('maxInvestment', Number(e.target.value))}
              min={0} step={1000} placeholder="Sin limite" style={inputStyle} />
          </Field>

          <Field label="Max Compras">
            <input type="number" value={form.maxBuys || ''} onChange={e => update('maxBuys', Number(e.target.value))}
              min={0} step={1} placeholder="Sin limite" style={inputStyle} />
          </Field>

          <Field label="Delay Min (h)">
            <input type="number" value={form.minDelay || ''} onChange={e => update('minDelay', Number(e.target.value))}
              min={0} step={1} placeholder="Sin delay" style={inputStyle} />
          </Field>

          <Field label="Time Exit (h)">
            <input type="number" value={form.timeExitHours || ''} onChange={e => update('timeExitHours', Number(e.target.value))}
              min={0} step={1} placeholder="Sin limite" style={inputStyle} />
          </Field>

          <Field label="RSI Time Exit (>=)">
            <input type="number" value={form.timeExitRSI || ''} onChange={e => update('timeExitRSI', Number(e.target.value))}
              min={1} max={100} step={1} placeholder="50" style={inputStyle} />
          </Field>
        </div>

        {/* Compound Interest */}
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--surface2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: form.compound.enabled ? '0.5rem' : 0 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)' }}>Interes Compuesto</span>
            <Toggle checked={form.compound.enabled} onChange={v => setForm(f => ({ ...f, compound: { ...f.compound, enabled: v } }))} />
          </div>
          {form.compound.enabled && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
              <Field label="Modo">
                <select value={form.compound.mode} onChange={e => setForm(f => ({ ...f, compound: { ...f.compound, mode: e.target.value } }))} style={inputStyle}>
                  <option value="level">Por nivel</option>
                  <option value="reinvest">Reinversion total</option>
                  <option value="step">Por pasos</option>
                </select>
              </Field>
              {form.compound.mode === 'step' && (
                <Field label="Monto del paso ($)">
                  <input type="number" value={form.compound.step || ''} onChange={e => setForm(f => ({ ...f, compound: { ...f.compound, step: Number(e.target.value) } }))}
                    min={100} step={100} placeholder="500" style={inputStyle} />
                </Field>
              )}
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', gridColumn: '1 / -1' }}>
                {form.compound.mode === 'level' && 'Cada vez que el beneficio alcance el monto base, el monto de operacion sube un nivel (1000 → 2000 → 3000...)'}
                {form.compound.mode === 'reinvest' && 'El monto de cada operacion es el monto base + todo el beneficio acumulado'}
                {form.compound.mode === 'step' && 'El monto sube en multiplos del paso cada vez que el beneficio cruza un multiplo'}
              </div>
            </div>
          )}
        </div>

        {/* RSI Conditional Rules */}
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--surface2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: form.rsiRules.enabled ? '0.5rem' : 0 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)' }}>Reglas RSI Condicionales</span>
            <Toggle checked={form.rsiRules.enabled} onChange={v => setForm(f => ({ ...f, rsiRules: { ...f.rsiRules, enabled: v } }))} />
          </div>
          {form.rsiRules.enabled && (
            <RsiRulesEditor rules={form.rsiRules.rules} onChange={rules => setForm(f => ({ ...f, rsiRules: { ...f.rsiRules, rules } }))} />
          )}
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
          <Field label="Desde" inline>
            <input type="date" value={form.fromDate} onChange={e => update('fromDate', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Hasta" inline>
            <input type="date" value={form.toDate} onChange={e => update('toDate', e.target.value)} style={inputStyle} />
          </Field>
          {PRESETS.map(p => (
            <button key={p.days} className="btn btn-sm" onClick={() => setPreset(p.days)}
              style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', background: 'var(--surface2)', color: 'var(--text-dim)', border: 'none', borderRadius: 4, marginTop: 16 }}>
              {p.label}
            </button>
          ))}
        </div>

        <button className="btn btn-primary" onClick={runBacktest}
          disabled={loading || (multiMode ? selectedSymbols.length < 2 : !form.symbol)}
          style={{ padding: '0.5rem 2rem' }}>
          {loading ? 'Ejecutando...' : multiMode ? `Ejecutar Multi-Backtest (${selectedSymbols.length} tokens)` : 'Ejecutar Backtest'}
        </button>
      </div>

      {loading && <Loading text={multiMode ? 'Ejecutando multi-backtest...' : 'Ejecutando backtest...'} />}

      {/* Results */}
      {result && !isMulti && (
        <SingleResults result={result} seguroOnly={seguroOnly} setSeguroOnly={setSeguroOnly} form={form} timezone={timezone} />
      )}
      {result && isMulti && (
        <MultiResults result={result} seguroOnly={seguroOnly} setSeguroOnly={setSeguroOnly} form={form} timezone={timezone} />
      )}
    </div>
  );
}

// ============================================================
// RSI Rules Editor
// ============================================================

const RSI_RULE_OPS = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: 'between', label: 'entre' },
];

const RSI_REF_TFS = [
  { value: '1h', label: 'RSI 1h' },
  { value: '4h', label: 'RSI 4h' },
  { value: '1d', label: 'RSI 1d' },
];

function RsiRulesEditor({ rules, onChange }) {
  function updateRule(ri, field, value) {
    onChange(rules.map((r, i) => i === ri ? { ...r, [field]: value } : r));
  }
  function updateCondition(ri, ci, field, value) {
    onChange(rules.map((r, i) => i === ri ? {
      ...r, conditions: r.conditions.map((c, j) => j === ci ? { ...c, [field]: value } : c),
    } : r));
  }
  function addCondition(ri) {
    onChange(rules.map((r, i) => i === ri ? {
      ...r, conditions: [...r.conditions, { timeframe: '1d', op: '>', value: 50 }],
    } : r));
  }
  function removeCondition(ri, ci) {
    onChange(rules.map((r, i) => i === ri ? {
      ...r, conditions: r.conditions.filter((_, j) => j !== ci),
    } : r));
  }
  function addRule() {
    onChange([...rules, { enabled: true, conditions: [{ timeframe: '1d', op: '>', value: 50 }], oversold: 32, overbought: 72 }]);
  }
  function removeRule(ri) {
    onChange(rules.filter((_, i) => i !== ri));
  }

  const selStyle = { padding: '0.2rem 0.4rem', fontSize: '0.8rem', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--surface2)', borderRadius: 4 };
  const numStyle = { width: 55, padding: '0.2rem 0.3rem', fontSize: '0.8rem', textAlign: 'right', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--surface2)', borderRadius: 4 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', margin: 0 }}>
        Define umbrales de compra/venta dinamicos segun RSI de otros timeframes. Las reglas se evaluan en orden.
      </p>
      {rules.map((rule, ri) => (
        <div key={ri} style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)' }}>Regla {ri + 1}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Toggle checked={rule.enabled !== false} onChange={v => updateRule(ri, 'enabled', v)} />
              <button onClick={() => removeRule(ri)} style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}>&times;</button>
            </div>
          </div>
          {/* Conditions */}
          {(rule.conditions || []).map((cond, ci) => (
            <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
              <select value={cond.timeframe} onChange={e => updateCondition(ri, ci, 'timeframe', e.target.value)} style={selStyle}>
                {RSI_REF_TFS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <select value={cond.op} onChange={e => updateCondition(ri, ci, 'op', e.target.value)} style={selStyle}>
                {RSI_RULE_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input type="number" value={cond.value ?? ''} onChange={e => updateCondition(ri, ci, 'value', Number(e.target.value))}
                step={1} style={numStyle} />
              {cond.op === 'between' && (
                <>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>y</span>
                  <input type="number" value={cond.value2 ?? ''} onChange={e => updateCondition(ri, ci, 'value2', Number(e.target.value))}
                    step={1} style={numStyle} />
                </>
              )}
              {rule.conditions.length > 1 && (
                <button onClick={() => removeCondition(ri, ci)} style={{ background: 'none', color: 'var(--text-dim)', border: 'none', cursor: 'pointer', fontSize: '0.7rem' }}>&times;</button>
              )}
              {ci < rule.conditions.length - 1 && <span style={{ fontSize: '0.7rem', color: 'var(--blue)', fontWeight: 600 }}>AND</span>}
            </div>
          ))}
          <button onClick={() => addCondition(ri)} style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', background: 'var(--surface2)', border: 'none', borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer', marginBottom: '0.5rem' }}>
            + Condicion AND
          </button>
          {/* Thresholds */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Compra RSI &le;</span>
              <input type="number" value={rule.oversold} onChange={e => updateRule(ri, 'oversold', Number(e.target.value))}
                min={1} max={100} step={1} style={numStyle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Venta RSI &ge;</span>
              <input type="number" value={rule.overbought} onChange={e => updateRule(ri, 'overbought', Number(e.target.value))}
                min={1} max={100} step={1} style={numStyle} />
            </div>
          </div>
        </div>
      ))}
      <button onClick={addRule} style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', background: 'var(--surface2)', border: 'none', borderRadius: 6, color: 'var(--text-dim)', cursor: 'pointer', alignSelf: 'flex-start' }}>
        + Regla
      </button>
    </div>
  );
}

// ============================================================
// Single-token results (unchanged)
// ============================================================

function SingleResults({ result, seguroOnly, setSeguroOnly, form, timezone }) {
  return (
    <div>
      {result.trades.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => exportCSV(seguroOnly ? { ...result, trades: result.trades.filter(t => t.seguro) } : result, form, timezone, false)}
            style={{ padding: '0.4rem 1rem', background: 'var(--surface2)', color: 'var(--text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}>
            Exportar CSV{seguroOnly ? ' (solo seguro)' : ''}
          </button>
          {result.trades.some(t => t.seguro) && (
            <button className="btn btn-sm" onClick={() => setSeguroOnly(!seguroOnly)}
              style={{ padding: '0.4rem 1rem', background: seguroOnly ? 'rgba(34,197,94,0.15)' : 'var(--surface2)', color: seguroOnly ? 'var(--green)' : 'var(--text-dim)', border: seguroOnly ? '1px solid rgba(34,197,94,0.4)' : 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem', fontWeight: seguroOnly ? 600 : 400 }}>
              Solo Seguro{seguroOnly ? ` (${result.trades.filter(t => t.seguro).length})` : ''}
            </button>
          )}
        </div>
      )}
      <StatsGrid result={result} seguroOnly={seguroOnly} />
      {result.equityCurve && result.equityCurve.length > 1 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 10, padding: '1rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text)', fontSize: '0.9rem' }}>Curva de Equity</h4>
          <EquityChart data={result.equityCurve} trades={result.trades} totalPnl={result.stats.totalPnl} />
        </div>
      )}
      <TradesTable trades={result.trades} seguroOnly={seguroOnly} timezone={timezone} showSymbol={false} />
    </div>
  );
}

// ============================================================
// Multi-token results
// ============================================================

function MultiResults({ result, seguroOnly, setSeguroOnly, form, timezone }) {
  const allTrades = result.trades;
  const combined = result.combined;
  const bySymbol = result.bySymbol;
  const symbols = Object.keys(bySymbol);

  return (
    <div>
      {/* Export + Seguro filter */}
      {allTrades.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => exportCSV(seguroOnly ? { ...result, trades: allTrades.filter(t => t.seguro) } : result, form, timezone, true)}
            style={{ padding: '0.4rem 1rem', background: 'var(--surface2)', color: 'var(--text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}>
            Exportar CSV{seguroOnly ? ' (solo seguro)' : ''}
          </button>
          {allTrades.some(t => t.seguro) && (
            <button className="btn btn-sm" onClick={() => setSeguroOnly(!seguroOnly)}
              style={{ padding: '0.4rem 1rem', background: seguroOnly ? 'rgba(34,197,94,0.15)' : 'var(--surface2)', color: seguroOnly ? 'var(--green)' : 'var(--text-dim)', border: seguroOnly ? '1px solid rgba(34,197,94,0.4)' : 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem', fontWeight: seguroOnly ? 600 : 400 }}>
              Solo Seguro{seguroOnly ? ` (${allTrades.filter(t => t.seguro).length})` : ''}
            </button>
          )}
        </div>
      )}

      {/* Combined stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <StatCard label="Tokens" value={symbols.length} />
        <StatCard label="Operaciones" value={combined.totalTrades} />
        <StatCard label="Win Rate" value={`${combined.winRate.toFixed(1)}%`}
          color={combined.winRate >= 50 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="P&L Total" value={formatPnl(combined.totalPnl)}
          color={combined.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="P&L Total (%)" value={`${combined.totalPnlPct.toFixed(2)}%`}
          color={combined.totalPnlPct >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="P&L Medio" value={`${combined.avgPnlPct.toFixed(2)}%`}
          color={combined.avgPnlPct >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="Mejor" value={combined.bestTrade ? formatPnl(combined.bestTrade.pnl) : '-'} color="var(--green)" />
        <StatCard label="Peor" value={combined.worstTrade ? formatPnl(combined.worstTrade.pnl) : '-'} color="var(--red)" />
        <StatCard label="Fees Totales" value={`$${combined.totalFees.toFixed(2)}`} color="var(--text-dim)" />
      </div>

      {/* Per-symbol comparison */}
      {symbols.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 10, padding: '1rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text)', fontSize: '0.9rem' }}>Comparativa por Token</h4>
          <SortableTable
            columns={[
              { key: 'symbol', label: 'Token' },
              { key: 'totalTrades', label: 'Trades' },
              { key: 'wins', label: 'Wins' },
              { key: 'losses', label: 'Losses' },
              { key: 'winRate', label: 'Win Rate', render: v => `${v.toFixed(1)}%` },
              { key: 'totalPnl', label: 'P&L', render: v => (
                <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{formatPnl(v)}</span>
              )},
              { key: 'totalPnlPct', label: 'P&L %', render: v => (
                <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{v.toFixed(2)}%</span>
              )},
              { key: 'totalFees', label: 'Fees', render: v => `$${v.toFixed(2)}` },
              { key: 'avgPnlPct', label: 'P&L Medio', render: v => (
                <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{v.toFixed(2)}%</span>
              )},
            ]}
            data={symbols.map(s => ({ symbol: s, ...bySymbol[s].stats })).sort((a, b) => b.totalPnl - a.totalPnl)}
            emptyText="Sin datos"
          />
        </div>
      )}

      {/* Equity curve */}
      {result.equityCurve && result.equityCurve.length > 1 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 10, padding: '1rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text)', fontSize: '0.9rem' }}>Curva de Equity Combinada</h4>
          <EquityChart data={result.equityCurve} trades={allTrades} totalPnl={combined.totalPnl} />
        </div>
      )}

      {/* All trades table */}
      <TradesTable trades={allTrades} seguroOnly={seguroOnly} timezone={timezone} showSymbol={true} />
    </div>
  );
}

// ============================================================
// Shared components
// ============================================================

function TradesTable({ trades, seguroOnly, timezone, showSymbol }) {
  const filteredTrades = seguroOnly ? trades.filter(t => t.seguro) : trades;
  if (filteredTrades.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--surface2)' }}>
        No se generaron operaciones en este periodo. Prueba con otro rango de fechas o ajusta los umbrales RSI.
      </div>
    );
  }

  const columns = [];
  if (showSymbol) {
    columns.push({ key: 'symbol', label: 'Token', render: v => <strong style={{ color: 'var(--blue)' }}>{v}</strong> });
  }
  columns.push(
    { key: 'openedAt', label: 'Apertura', render: v => formatTs(v, timezone) },
    { key: 'closedAt', label: 'Cierre', render: v => formatTs(v, timezone) },
    { key: 'duration', label: 'Duracion', render: v => formatDuration(v) },
    { key: 'entryPrice', label: 'P. Compra', render: v => v != null ? `$${formatPrice(v)}` : '-' },
    { key: 'exitPrice', label: 'P. Venta', render: v => v != null ? `$${formatPrice(v)}` : '-' },
    { key: 'amount', label: 'Inversion', render: v => `$${v?.toFixed(2)}` },
    { key: 'rsiAtOpen', label: 'RSI Compra', render: v => v?.toFixed(1) ?? '-' },
    { key: 'rsiAtClose', label: 'RSI Venta', render: v => v?.toFixed(1) ?? '-' },
    { key: 'rsi1hAtClose', label: 'RSI 1h', render: v => v != null ? v.toFixed(1) : '-' },
    { key: 'rsi4hAtClose', label: 'RSI 4h', render: v => v != null ? v.toFixed(1) : '-' },
    { key: 'rsi1dAtClose', label: 'RSI 1d', render: v => v != null ? v.toFixed(1) : '-' },
    { key: 'activeRule', label: 'Regla', render: v => v != null && v >= 0 ? `R${v + 1}` : '' },
    { key: 'pnl', label: 'P&L ($)', render: v => (
      <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{formatPnl(v)}</span>
    )},
    { key: 'pnlPct', label: 'P&L (%)', render: v => (
      <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{v?.toFixed(2)}%</span>
    )},
    { key: 'totalFees', label: 'Fees', render: v => v ? `$${v.toFixed(2)}` : '-' },
    { key: 'sma200_1h', label: 'SMA200 1h', render: v => v != null ? `$${formatPrice(v)}` : '-' },
    { key: 'sma200_4h', label: 'SMA200 4h', render: v => v != null ? `$${formatPrice(v)}` : '-' },
    { key: 'seguro', label: 'Seguro', render: v => v ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>SI</span> : '' },
    { key: 'timeExit', label: 'T.Exit', render: v => v ? 'TIME' : '' },
  );

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 10, padding: '1rem' }}>
      <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text)', fontSize: '0.9rem' }}>
        Operaciones ({filteredTrades.length}{seguroOnly ? ' seguro' : ''})
      </h4>
      <SortableTable columns={columns} data={[...filteredTrades].reverse()} emptyText="Sin operaciones" />
    </div>
  );
}

function Field({ label, children, inline }) {
  return (
    <div style={inline ? { display: 'flex', alignItems: 'center', gap: 4 } : {}}>
      <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>{label}</label>
      {children}
    </div>
  );
}

function StatsGrid({ result, seguroOnly }) {
  const trades = seguroOnly ? result.trades.filter(t => t.seguro) : result.trades;
  const wins = trades.filter(t => t.pnl > 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const totalPnlPct = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const totalFees = trades.reduce((sum, t) => sum + t.totalFees, 0);
  const avgPnlPct = trades.length > 0 ? totalPnlPct / trades.length : 0;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const best = trades.length > 0 ? trades.reduce((b, t) => t.pnl > b.pnl ? t : b) : null;
  const worst = trades.length > 0 ? trades.reduce((w, t) => t.pnl < w.pnl ? t : w) : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
      <StatCard label={seguroOnly ? 'Operaciones Seguro' : 'Operaciones'} value={trades.length} />
      <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`}
        color={winRate >= 50 ? 'var(--green)' : 'var(--red)'} />
      <StatCard label="P&L Total" value={formatPnl(totalPnl)}
        color={totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
      <StatCard label="P&L Total (%)" value={`${totalPnlPct.toFixed(2)}%`}
        color={totalPnlPct >= 0 ? 'var(--green)' : 'var(--red)'} />
      <StatCard label="P&L Medio" value={`${avgPnlPct.toFixed(2)}%`}
        color={avgPnlPct >= 0 ? 'var(--green)' : 'var(--red)'} />
      <StatCard label="Mejor" value={best ? formatPnl(best.pnl) : '-'} color="var(--green)" />
      <StatCard label="Peor" value={worst ? formatPnl(worst.pnl) : '-'} color="var(--red)" />
      <StatCard label="Fees Totales" value={`$${totalFees.toFixed(2)}`} color="var(--text-dim)" />
      {!seguroOnly && <StatCard label="Velas analizadas" value={result.stats.candlesAnalyzed} color="var(--text-dim)" />}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '0.8rem', border: '1px solid var(--surface2)', textAlign: 'center' }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

function EquityChart({ data, trades, totalPnl }) {
  if (!data || data.length < 2) return null;

  const values = data.map(d => d.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100;
  const h = 30;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d.equity - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  const color = totalPnl >= 0 ? 'var(--green)' : 'var(--red)';
  const tradeTimes = new Set(trades.map(t => t.closedAt));

  return (
    <svg viewBox={`0 0 ${w} ${h + 4}`} style={{ width: '100%', height: 180 }}>
      {min < 0 && max > 0 && (
        <line x1="0" y1={h - ((0 - min) / range) * h} x2={w} y2={h - ((0 - min) / range) * h}
          stroke="var(--surface2)" strokeWidth="0.3" strokeDasharray="1,1" />
      )}
      <polyline fill="none" stroke={color} strokeWidth="0.5" points={points} />
      {data.filter(d => tradeTimes.has(d.timestamp)).map((d, i) => {
        const x = (data.indexOf(d) / (data.length - 1)) * w;
        const trade = trades.find(t => t.closedAt === d.timestamp);
        return (
          <circle key={i} cx={x} cy={h - ((d.equity - min) / range) * h} r="0.8"
            fill={trade && trade.pnl >= 0 ? 'var(--green)' : 'var(--red)'} opacity="0.7" />
        );
      })}
    </svg>
  );
}

// --- Formatters ---

const inputStyle = {
  width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.85rem',
  background: 'var(--bg)', border: '1px solid var(--surface2)', borderRadius: 6, color: 'var(--text)',
};

function formatPrice(val) {
  if (val == null) return '-';
  const abs = Math.abs(val);
  if (abs >= 1000) return val.toFixed(2);
  if (abs >= 1) return val.toFixed(4);
  if (abs >= 0.01) return val.toFixed(6);
  return val.toFixed(8);
}

function formatPnl(val) {
  if (val === null || val === undefined) return '-';
  return val >= 0 ? `+$${val.toFixed(2)}` : `-$${Math.abs(val).toFixed(2)}`;
}

function formatTs(ts, timezone) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('es-ES', { timeZone: timezone, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms) {
  if (!ms) return '-';
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(ms / 60000)}m`;
}

function exportCSV(result, form, timezone, isMulti) {
  const trades = result.trades;
  const stats = isMulti ? result.combined : result.stats;
  const symbolLabel = isMulti ? Object.keys(result.bySymbol || {}).join('+') : form.symbol;

  const headers = ['Token', 'Apertura', 'Cierre', 'Duracion', 'P. Compra', 'P. Venta', 'Inversion', 'RSI Compra', 'RSI Venta', 'RSI 1h', 'RSI 4h', 'RSI 1d', 'Regla', 'P&L ($)', 'P&L (%)', 'Fee Compra', 'Fee Venta', 'Fees Total', 'SMA200 1h', 'SMA200 4h', 'Seguro', 'Time Exit'];
  const rows = trades.map(t => [
    t.symbol || form.symbol,
    formatTs(t.openedAt, timezone),
    formatTs(t.closedAt, timezone),
    formatDuration(t.duration),
    formatPrice(t.entryPrice),
    formatPrice(t.exitPrice),
    t.amount?.toFixed(2),
    t.rsiAtOpen?.toFixed(1) ?? '',
    t.rsiAtClose?.toFixed(1) ?? '',
    t.rsi1hAtClose != null ? t.rsi1hAtClose.toFixed(1) : '',
    t.rsi4hAtClose != null ? t.rsi4hAtClose.toFixed(1) : '',
    t.rsi1dAtClose != null ? t.rsi1dAtClose.toFixed(1) : '',
    t.activeRule != null && t.activeRule >= 0 ? `R${t.activeRule + 1}` : '',
    t.pnl?.toFixed(2),
    t.pnlPct?.toFixed(2),
    t.feeBuy?.toFixed(2) ?? '',
    t.feeSell?.toFixed(2) ?? '',
    t.totalFees?.toFixed(2) ?? '',
    t.sma200_1h != null ? formatPrice(t.sma200_1h) : '',
    t.sma200_4h != null ? formatPrice(t.sma200_4h) : '',
    t.seguro ? 'SI' : '',
    t.timeExit ? 'TIME' : '',
  ]);

  const summary = [
    '',
    `Backtest: ${symbolLabel} | ${form.timeframe} | ${form.fromDate} - ${form.toDate}`,
    `Operaciones: ${stats.totalTrades} | Win Rate: ${stats.winRate.toFixed(1)}% | P&L Total: ${stats.totalPnl.toFixed(2)} | Fees Total: ${(stats.totalFees || 0).toFixed(2)}`,
  ];

  const csv = [headers.join(','), ...rows.map(r => r.join(',')), ...summary].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backtest_${symbolLabel}_${form.timeframe}_${form.fromDate}_${form.toDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
