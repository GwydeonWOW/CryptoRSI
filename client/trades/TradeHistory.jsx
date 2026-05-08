import { useState, useEffect } from 'react';
import { useAuthAPI, getAuthHeaders } from '../hooks/useAPI';
import Loading from '../components/Loading';

export default function TradeHistory({ refreshTrigger, user }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [tfFilter, setTfFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await useAuthAPI('/api/trade/auto-stats');
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function resetSimulator() {
    if (!confirm('Resetear todas las operaciones del simulador? Esta accion no se puede deshacer.')) return;
    try {
      const res = await fetch('/api/trade/auto-reset', { method: 'DELETE', headers: getAuthHeaders() });
      const data = await res.json();
      if (data.success) { setFilter('ALL'); setTfFilter('ALL'); load(); }
      else alert(data.error || 'Error al resetear');
    } catch (e) { alert('Error: ' + e.message); }
  }

  const isSupremeAdmin = user?.id === 'admin_001' || user?.username === 'admin';

  useEffect(() => { load(); }, []);
  useEffect(() => { if (refreshTrigger > 0) load(); }, [refreshTrigger]);

  if (loading && !data) return <Loading text="Cargando simulador..." />;
  if (error && !data) return <div className="history-empty">Error: {error}</div>;
  if (!data) return null;

  const { overall, perToken, history, positions } = data;

  const symbols = [...new Set([
    ...Object.keys(perToken || {}),
    ...(positions || []).map(p => p.symbol),
  ])];
  const timeframes = [...new Set([
    ...(positions || []).map(p => p.timeframe).filter(Boolean),
    ...history.map(t => t.timeframe).filter(Boolean),
  ])];

  const applyFilters = (items) => {
    let filtered = items;
    if (filter !== 'ALL') filtered = filtered.filter(t => t.symbol === filter);
    if (tfFilter !== 'ALL') filtered = filtered.filter(t => t.timeframe === tfFilter);
    return filtered;
  };

  const filteredHistory = applyFilters(history);
  const filteredPositions = applyFilters(positions);

  const filteredPnl = filteredHistory.reduce((s, t) => s + t.pnl, 0);
  const filteredTrades = filteredHistory.length;
  const filteredWins = filteredHistory.filter(t => t.pnl > 0).length;

  return (
    <div>
      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <StatCard label="Operaciones" value={overall.totalTrades} />
        <StatCard label="Win Rate" value={overall.totalTrades > 0 ? `${overall.winRate.toFixed(0)}%` : '-'} color={overall.winRate >= 50 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="P&L Total" value={formatPnl(overall.totalPnl)} color={overall.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="P&L Medio" value={overall.totalTrades > 0 ? `${overall.avgPnlPct.toFixed(1)}%` : '-'} color={overall.avgPnlPct >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="Posiciones Abiertas" value={positions.length} color="var(--blue)" />
      </div>

      {/* Per-Token Breakdown */}
      {symbols.length > 0 && (
        <div className="market-section" style={{ marginBottom: '1.5rem' }}>
          <h3 className="section-title">Resumen por Token</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem', marginTop: '0.75rem' }}>
            {symbols.map(sym => (
              <TokenSummary key={sym} symbol={sym} stats={perToken[sym] || { trades: 0, wins: 0, pnl: 0, pnlPct: [] }} active={filter === sym} onClick={() => setFilter(filter === sym ? 'ALL' : sym)} />
            ))}
          </div>
        </div>
      )}

      {/* Open Positions */}
      {filteredPositions.length > 0 && (
        <div className="market-section" style={{ marginBottom: '1.5rem' }}>
          <h3 className="section-title">Posiciones Abiertas</h3>
          <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Token</th>
                  <th style={thStyle}>TF</th>
                  <th style={thStyle}>Entrada</th>
                  <th style={thStyle}>Precio Compra</th>
                  <th style={thStyle}>Precio Actual</th>
                  <th style={thStyle}>Inversion</th>
                  <th style={thStyle}>RSI (Compra)</th>
                  <th style={thStyle}>SMA 200</th>
                  <th style={thStyle}>P&L</th>
                  <th style={thStyle}>P&L %</th>
                </tr>
              </thead>
              <tbody>
                {filteredPositions.map(pos => (
                  <tr key={pos.id}>
                    <td style={tdStyle}><strong>{pos.symbol}</strong></td>
                    <td style={tdStyle}><TfBadge tf={pos.timeframe} /></td>
                    <td style={tdStyle}>{formatDate(pos.openedAt)}</td>
                    <td style={tdStyle}>${pos.entryPrice?.toFixed(2)}</td>
                    <td style={tdStyle}>{pos.currentPrice ? `$${pos.currentPrice.toFixed(2)}` : '-'}</td>
                    <td style={tdStyle}>${pos.amount?.toFixed(2)}</td>
                    <td style={tdStyle}>{formatRSISummary(pos.rsi)}</td>
                    <td style={tdStyle}>{pos.rsi?.sma200?.toFixed(0) || '-'}</td>
                    <td style={{ ...tdStyle, color: pos.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatPnl(pos.pnl)}</td>
                    <td style={{ ...tdStyle, color: pos.pnlPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{pos.pnlPct?.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trade History */}
      <div className="market-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 className="section-title" style={{ marginBottom: 0 }}>Historial de Operaciones</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Filtrar:</span>
            <select value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
              <option value="ALL">Todos</option>
              {symbols.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={tfFilter} onChange={e => setTfFilter(e.target.value)} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
              <option value="ALL">Todos TF</option>
              {timeframes.map(tf => <option key={tf} value={tf}>{tf}</option>)}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Actualizar</button>
            {filteredHistory.length > 0 && <>
              <button className="btn btn-secondary btn-sm" onClick={() => exportCSV(filteredHistory)}>Exportar CSV</button>
              <button className="btn btn-secondary btn-sm" onClick={() => exportExcel(filteredHistory)}>Exportar Excel</button>
            </>}
            {isSupremeAdmin && (
              <button className="btn btn-sm" onClick={resetSimulator} disabled={loading}
                style={{ color: 'var(--red)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                Resetear
              </button>
            )}
          </div>
        </div>

        {(filter !== 'ALL' || tfFilter !== 'ALL') && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
            {filter !== 'ALL' && `${filter}: `}
            {tfFilter !== 'ALL' && `TF ${tfFilter} | `}
            {filteredTrades} ops | Win rate: {filteredTrades > 0 ? `${((filteredWins / filteredTrades) * 100).toFixed(0)}%` : '-'} | P&L: <span style={{ color: filteredPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatPnl(filteredPnl)}</span>
          </div>
        )}

        {filteredHistory.length === 0 ? (
          <div className="history-empty">Sin operaciones cerradas{(filter !== 'ALL' || tfFilter !== 'ALL') ? ` para este filtro` : ''}.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Token</th>
                  <th style={thStyle}>TF</th>
                  <th style={thStyle}>Apertura</th>
                  <th style={thStyle}>Cierre</th>
                  <th style={thStyle}>Duracion</th>
                  <th style={thStyle}>P. Compra</th>
                  <th style={thStyle}>P. Venta</th>
                  <th style={thStyle}>Inversion</th>
                  <th style={thStyle}>RSI (Compra)</th>
                  <th style={thStyle}>RSI (Venta)</th>
                  <th style={thStyle}>SMA 200</th>
                  <th style={thStyle}>P&L ($)</th>
                  <th style={thStyle}>P&L (%)</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredHistory].reverse().map((t, i) => (
                  <tr key={i}>
                    <td style={tdStyle}><strong>{t.symbol}</strong></td>
                    <td style={tdStyle}><TfBadge tf={t.timeframe} /></td>
                    <td style={tdStyle}>{formatDate(t.openedAt)}</td>
                    <td style={tdStyle}>{formatDate(t.closedAt)}</td>
                    <td style={tdStyle}>{formatDuration(t.openedAt, t.closedAt)}</td>
                    <td style={tdStyle}>${t.entryPrice?.toFixed(2)}</td>
                    <td style={tdStyle}>${t.exitPrice?.toFixed(2)}</td>
                    <td style={tdStyle}>${t.amount?.toFixed(2)}</td>
                    <td style={tdStyle}>{formatRSISummary(t.rsi)}</td>
                    <td style={tdStyle}>{formatRSISummary(t.rsiClose)}</td>
                    <td style={tdStyle}>{t.rsi?.sma200?.toFixed(0) || '-'}</td>
                    <td style={{ ...tdStyle, color: t.pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{formatPnl(t.pnl)}</td>
                    <td style={{ ...tdStyle, color: t.pnlPct >= 0 ? 'var(--green)' : 'var(--red)' }}>{t.pnlPct?.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TfBadge({ tf }) {
  if (!tf) return <span style={{ color: 'var(--text-dim)' }}>-</span>;
  const colors = { '15m': '#8b5cf6', '1h': '#3b82f6', '4h': '#f59e0b', '1d': '#10b981' };
  return (
    <span style={{
      fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: `${colors[tf] || '#6b7280'}20`, color: colors[tf] || '#6b7280',
    }}>
      {tf}
    </span>
  );
}

function formatRSISummary(rsi) {
  if (!rsi) return '-';
  const parts = [];
  if (rsi.rsi15m != null) parts.push(`15m:${rsi.rsi15m.toFixed(0)}`);
  if (rsi.rsi1h != null) parts.push(`1h:${rsi.rsi1h.toFixed(0)}`);
  if (rsi.rsi4h != null) parts.push(`4h:${rsi.rsi4h.toFixed(0)}`);
  if (rsi.rsi1d != null) parts.push(`1d:${rsi.rsi1d.toFixed(0)}`);
  if (parts.length === 0) {
    const sig = rsi.signalRSI ?? rsi;
    return typeof sig === 'number' ? sig.toFixed(1) : '-';
  }
  return parts.join(' ');
}

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 10, padding: '1rem',
      border: '1px solid var(--surface2)', textAlign: 'center',
    }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '0.25rem', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

function TokenSummary({ symbol, stats, active, onClick }) {
  const winRate = stats.trades > 0 ? ((stats.wins / stats.trades) * 100).toFixed(0) : '-';
  const avgPct = stats.pnlPct.length > 0 ? (stats.pnlPct.reduce((a, b) => a + b, 0) / stats.pnlPct.length).toFixed(1) : '-';
  return (
    <div onClick={onClick} style={{
      background: active ? 'rgba(59,130,246,0.1)' : 'var(--bg)',
      border: `1px solid ${active ? 'var(--blue)' : 'var(--surface2)'}`,
      borderRadius: 8, padding: '0.75rem', cursor: 'pointer', transition: '0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>{symbol}</strong>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: stats.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatPnl(stats.pnl)}</span>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
        {stats.trades} ops | WR: {winRate}% | Avg: {avgPct}%
      </div>
    </div>
  );
}

// --- Export functions ---

const EXPORT_COLUMNS = [
  { key: 'symbol', label: 'Token' },
  { key: 'timeframe', label: 'Timeframe', fmt: (_, t) => t.timeframe || '-' },
  { key: 'openedAt', label: 'Fecha Apertura', fmt: v => v ? new Date(v).toLocaleString('es-ES') : '' },
  { key: 'closedAt', label: 'Fecha Cierre', fmt: v => v ? new Date(v).toLocaleString('es-ES') : '' },
  { key: 'duration', label: 'Duracion', fmt: (_, t) => formatDuration(t.openedAt, t.closedAt) },
  { key: 'entryPrice', label: 'Precio Compra', fmt: v => v?.toFixed(2) || '' },
  { key: 'exitPrice', label: 'Precio Venta', fmt: v => v?.toFixed(2) || '' },
  { key: 'amount', label: 'Inversion ($)', fmt: v => v?.toFixed(2) || '' },
  { key: 'exitValue', label: 'Valor Salida ($)', fmt: v => v?.toFixed(2) || '' },
  { key: 'quantity', label: 'Cantidad', fmt: v => v?.toFixed(6) || '' },
  { key: 'rsiOpen15m', label: 'RSI 15m (Compra)', fmt: (_, t) => t.rsi?.rsi15m?.toFixed(1) || t.rsiAtOpen?.toFixed(1) || '' },
  { key: 'rsiOpen1h', label: 'RSI 1h (Compra)', fmt: (_, t) => t.rsi?.rsi1h?.toFixed(1) || '' },
  { key: 'rsiOpen4h', label: 'RSI 4h (Compra)', fmt: (_, t) => t.rsi?.rsi4h?.toFixed(1) || '' },
  { key: 'rsiOpen1d', label: 'RSI 1d (Compra)', fmt: (_, t) => t.rsi?.rsi1d?.toFixed(1) || '' },
  { key: 'sma200', label: 'SMA 200 (Compra)', fmt: (_, t) => t.rsi?.sma200?.toFixed(0) || '' },
  { key: 'signalRSIOpen', label: 'RSI Signal (Compra)', fmt: (_, t) => t.rsi?.signalRSI?.toFixed(1) || t.rsiAtOpen?.toFixed(1) || '' },
  { key: 'rsiClose15m', label: 'RSI 15m (Venta)', fmt: (_, t) => t.rsiClose?.rsi15m?.toFixed(1) || '' },
  { key: 'rsiClose1h', label: 'RSI 1h (Venta)', fmt: (_, t) => t.rsiClose?.rsi1h?.toFixed(1) || '' },
  { key: 'rsiClose4h', label: 'RSI 4h (Venta)', fmt: (_, t) => t.rsiClose?.rsi4h?.toFixed(1) || '' },
  { key: 'rsiClose1d', label: 'RSI 1d (Venta)', fmt: (_, t) => t.rsiClose?.rsi1d?.toFixed(1) || '' },
  { key: 'signalRSIClose', label: 'RSI Signal (Venta)', fmt: (_, t) => t.rsiClose?.signalRSI?.toFixed(1) || t.rsiAtClose?.toFixed(1) || '' },
  { key: 'pnl', label: 'P&L ($)', fmt: v => v?.toFixed(2) || '' },
  { key: 'pnlPct', label: 'P&L (%)', fmt: v => v?.toFixed(2) || '' },
];

function buildRows(trades) {
  return trades.map(t => EXPORT_COLUMNS.map(c => {
    const raw = c.key === 'duration' ? null : t[c.key];
    return c.fmt ? c.fmt(raw, t) : (raw ?? '');
  }));
}

function exportCSV(trades) {
  const header = EXPORT_COLUMNS.map(c => c.label).join(';');
  const rows = buildRows(trades).map(r => r.join(';')).join('\n');
  const csv = '﻿' + header + '\n' + rows;
  downloadFile(csv, 'simulador_operaciones.csv', 'text/csv;charset=utf-8');
}

function exportExcel(trades) {
  const headerRow = EXPORT_COLUMNS.map(c => `<td style="font-weight:bold;background:#f0f0f0">${c.label}</td>`).join('');
  const dataRows = buildRows(trades).map(r =>
    '<tr>' + r.map(v => `<td style="mso-number-format:\\@">${escapeHtml(String(v))}</td>`).join('') + '</tr>'
  ).join('');

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Operaciones</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body><table><tr>${headerRow}</tr>${dataRows}</table></body></html>`;

  downloadFile(html, 'simulador_operaciones.xls', 'application/vnd.ms-excel');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Formatters ---

function formatPnl(val) {
  if (val === null || val === undefined) return '-';
  return val >= 0 ? `+$${val.toFixed(2)}` : `-$${Math.abs(val).toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(from, to) {
  if (!from || !to) return '-';
  const ms = new Date(to) - new Date(from);
  if (ms < 0) return '-';
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${Math.floor((ms % 3600000) / 60000)}m`;
  return `${Math.floor(ms / 60000)}m`;
}

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' };
const thStyle = { textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--surface2)', color: 'var(--text-dim)', fontWeight: 500, fontSize: '0.7rem', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const tdStyle = { padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--surface2)', whiteSpace: 'nowrap' };
