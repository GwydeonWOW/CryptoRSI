import { useState, useEffect } from 'react';
import { getAuthHeaders, useAuthAPI } from '../hooks/useAPI';
import { useToast } from '../hooks/useToast';
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
  const [tokens, setTokens] = useState([]);
  const [defaults, setDefaults] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

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

  async function runBacktest() {
    if (!form.symbol) { addToast('error', 'Selecciona un token'); return; }
    setLoading(true);
    setResult(null);
    try {
      // Send timestamps in user's local timezone so the backend
      // uses the correct date range regardless of server timezone
      const [fy, fm, fd] = form.fromDate.split('-').map(Number);
      const [ty, tm, td] = form.toDate.split('-').map(Number);
      const startMs = new Date(fy, fm - 1, fd).getTime();
      const endMs = new Date(ty, tm - 1, td, 23, 59, 59, 999).getTime();

      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ...form, startMs, endMs }),
      });
      const data = await res.json();
      if (!res.ok) { addToast('error', data.error); return; }
      setResult(data);
    } catch (e) {
      addToast('error', e.message);
    } finally {
      setLoading(false);
    }
  }

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <div>
      {/* Config Panel */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--surface2)',
        borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem',
      }}>
        <h3 className="section-title" style={{ marginBottom: '1rem' }}>Configuracion del Backtest</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
          {/* Symbol */}
          <Field label="Token">
            <select value={form.symbol} onChange={e => update('symbol', e.target.value)} style={inputStyle}>
              <option value="">Seleccionar...</option>
              {tokens.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
            </select>
          </Field>

          {/* Timeframe */}
          <Field label="Timeframe">
            <select value={form.timeframe} onChange={e => update('timeframe', e.target.value)} style={inputStyle}>
              {TIMEFRAME_OPTIONS.map(tf => <option key={tf.value} value={tf.value}>{tf.label}</option>)}
            </select>
          </Field>

          {/* Amount */}
          <Field label="Monto ($)">
            <input type="number" value={form.amount} onChange={e => update('amount', Number(e.target.value))}
              min={10} step={100} style={inputStyle} />
          </Field>

          {/* Fee */}
          <Field label="Fee (%)">
            <input type="number" value={form.feePercent} onChange={e => update('feePercent', Number(e.target.value))}
              min={0} max={10} step={0.001} style={inputStyle} />
          </Field>

          {/* RSI Oversold */}
          <Field label="RSI Compra (<=)">
            <input type="number" value={form.rsiOversold} onChange={e => update('rsiOversold', Number(e.target.value))}
              min={1} max={100} step={1} style={inputStyle} />
          </Field>

          {/* RSI Overbought */}
          <Field label="RSI Venta (>=)">
            <input type="number" value={form.rsiOverbought} onChange={e => update('rsiOverbought', Number(e.target.value))}
              min={1} max={100} step={1} style={inputStyle} />
          </Field>
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

        <button className="btn btn-primary" onClick={runBacktest} disabled={loading || !form.symbol}
          style={{ padding: '0.5rem 2rem' }}>
          {loading ? 'Ejecutando...' : 'Ejecutar Backtest'}
        </button>
      </div>

      {loading && <Loading text="Ejecutando backtest..." />}

      {/* Results */}
      {result && (
        <div>
          {/* Export buttons */}
          {result.trades.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button className="btn btn-sm" onClick={() => exportCSV(result, form)}
                style={{ padding: '0.4rem 1rem', background: 'var(--surface2)', color: 'var(--text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}>
                Exportar CSV
              </button>
            </div>
          )}
          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <StatCard label="Operaciones" value={result.stats.totalTrades} />
            <StatCard label="Win Rate" value={`${result.stats.winRate.toFixed(1)}%`}
              color={result.stats.winRate >= 50 ? 'var(--green)' : 'var(--red)'} />
            <StatCard label="P&L Total" value={formatPnl(result.stats.totalPnl)}
              color={result.stats.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
            <StatCard label="P&L Medio" value={`${result.stats.avgPnlPct.toFixed(2)}%`}
              color={result.stats.avgPnlPct >= 0 ? 'var(--green)' : 'var(--red)'} />
            <StatCard label="Mejor" value={result.stats.bestTrade ? formatPnl(result.stats.bestTrade.pnl) : '-'} color="var(--green)" />
            <StatCard label="Peor" value={result.stats.worstTrade ? formatPnl(result.stats.worstTrade.pnl) : '-'} color="var(--red)" />
            <StatCard label="Fees Totales" value={`$${(result.stats.totalFees || 0).toFixed(2)}`} color="var(--text-dim)" />
            <StatCard label="Velas analizadas" value={result.stats.candlesAnalyzed} color="var(--text-dim)" />
          </div>

          {/* Equity Curve */}
          {result.equityCurve && result.equityCurve.length > 1 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 10, padding: '1rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text)', fontSize: '0.9rem' }}>Curva de Equity</h4>
              <EquityChart data={result.equityCurve} trades={result.trades} totalPnl={result.stats.totalPnl} />
            </div>
          )}

          {/* Trades Table */}
          {result.trades.length > 0 ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 10, padding: '1rem' }}>
              <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text)', fontSize: '0.9rem' }}>Operaciones ({result.trades.length})</h4>
              <SortableTable
                columns={[
                  { key: 'openedAt', label: 'Apertura', render: v => formatTs(v) },
                  { key: 'closedAt', label: 'Cierre', render: v => formatTs(v) },
                  { key: 'duration', label: 'Duracion', render: v => formatDuration(v) },
                  { key: 'entryPrice', label: 'P. Compra', render: v => `$${v?.toFixed(2)}` },
                  { key: 'exitPrice', label: 'P. Venta', render: v => `$${v?.toFixed(2)}` },
                  { key: 'amount', label: 'Inversion', render: v => `$${v?.toFixed(2)}` },
                  { key: 'rsiAtOpen', label: 'RSI Compra', render: v => v?.toFixed(1) ?? '-' },
                  { key: 'rsiAtClose', label: 'RSI Venta', render: v => v?.toFixed(1) ?? '-' },
                  { key: 'pnl', label: 'P&L ($)', render: v => (
                    <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{formatPnl(v)}</span>
                  )},
                  { key: 'pnlPct', label: 'P&L (%)', render: v => (
                    <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{v?.toFixed(2)}%</span>
                  )},
                  { key: 'totalFees', label: 'Fees', render: v => v ? `$${v.toFixed(2)}` : '-' },
                ]}
                data={[...result.trades].reverse()}
                emptyText="Sin operaciones"
              />
            </div>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--surface2)' }}>
              No se generaron operaciones en este periodo. Prueba con otro rango de fechas o ajusta los umbrales RSI.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Components ---

function Field({ label, children, inline }) {
  return (
    <div style={inline ? { display: 'flex', alignItems: 'center', gap: 4 } : {}}>
      <label style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'block', marginBottom: 2 }}>{label}</label>
      {children}
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

  // Find trade close timestamps for markers
  const tradeTimes = new Set(trades.map(t => t.closedAt));

  return (
    <svg viewBox={`0 0 ${w} ${h + 4}`} style={{ width: '100%', height: 180 }}>
      {/* Zero line */}
      {min < 0 && max > 0 && (
        <line x1="0" y1={h - ((0 - min) / range) * h} x2={w} y2={h - ((0 - min) / range) * h}
          stroke="var(--surface2)" strokeWidth="0.3" strokeDasharray="1,1" />
      )}
      {/* Area fill */}
      <polyline fill="none" stroke={color} strokeWidth="0.5" points={points} />
      {/* Trade markers */}
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

function formatPnl(val) {
  if (val === null || val === undefined) return '-';
  return val >= 0 ? `+$${val.toFixed(2)}` : `-$${Math.abs(val).toFixed(2)}`;
}

function formatTs(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms) {
  if (!ms) return '-';
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(ms / 60000)}m`;
}

function exportCSV(result, form) {
  const headers = ['Apertura', 'Cierre', 'Duracion', 'P. Compra', 'P. Venta', 'Inversion', 'RSI Compra', 'RSI Venta', 'P&L ($)', 'P&L (%)', 'Fee Compra', 'Fee Venta', 'Fees Total'];
  const rows = result.trades.map(t => [
    formatTs(t.openedAt),
    formatTs(t.closedAt),
    formatDuration(t.duration),
    t.entryPrice?.toFixed(4),
    t.exitPrice?.toFixed(4),
    t.amount?.toFixed(2),
    t.rsiAtOpen?.toFixed(1) ?? '',
    t.rsiAtClose?.toFixed(1) ?? '',
    t.pnl?.toFixed(2),
    t.pnlPct?.toFixed(2),
    t.feeBuy?.toFixed(2) ?? '',
    t.feeSell?.toFixed(2) ?? '',
    t.totalFees?.toFixed(2) ?? '',
  ]);

  const summary = [
    '',
    `Backtest: ${form.symbol} | ${form.timeframe} | ${form.fromDate} - ${form.toDate}`,
    `Operaciones: ${result.stats.totalTrades} | Win Rate: ${result.stats.winRate.toFixed(1)}% | P&L Total: ${result.stats.totalPnl.toFixed(2)} | Fees Total: ${(result.stats.totalFees || 0).toFixed(2)}`,
  ];

  const csv = [headers.join(','), ...rows.map(r => r.join(',')), ...summary].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backtest_${form.symbol}_${form.timeframe}_${form.fromDate}_${form.toDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
