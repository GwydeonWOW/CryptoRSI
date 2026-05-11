import { useState, useEffect } from 'react';
import { useAuthAPI, getAuthHeaders } from '../hooks/useAPI';
import Loading from '../components/Loading';
import { formatPrice } from '../dashboard/TokenCard';
import { useToast } from '../hooks/useToast';
import SortableTable from '../components/SortableTable';

export default function TradeHistory({ refreshTrigger, user }) {
  const [data, setData] = useState(null);
  const { addToast } = useToast();
  const [filter, setFilter] = useState('ALL');
  const [tfFilter, setTfFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  function buildUrl() {
    const params = new URLSearchParams();
    params.set('page', page);
    params.set('limit', perPage);
    if (filter !== 'ALL') params.set('symbol', filter);
    if (tfFilter !== 'ALL') params.set('timeframe', tfFilter);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    return `/api/trade/auto-stats?${params}`;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await useAuthAPI(buildUrl());
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function setDatePreset(preset) {
    const now = new Date();
    let from = '';
    switch (preset) {
      case 'today': from = now.toISOString().split('T')[0]; break;
      case 'week': { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); from = d.toISOString().split('T')[0]; break; }
      case 'month': from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; break;
      case '3months': { const d = new Date(now); d.setMonth(d.getMonth() - 3); from = d.toISOString().split('T')[0]; break; }
      case 'all': from = ''; setDateFrom(''); setDateTo(''); break;
    }
    if (preset !== 'all') setDateFrom(from);
    setPage(1);
  }

  async function resetSimulator() {
    if (!confirm('Resetear todas las operaciones del simulador? Esta accion no se puede deshacer.')) return;
    try {
      const res = await fetch('/api/trade/auto-reset', { method: 'DELETE', headers: getAuthHeaders() });
      const data = await res.json();
      if (data.success) { setFilter('ALL'); setTfFilter('ALL'); setDateFrom(''); setDateTo(''); setPage(1); load(); addToast('success', 'Simulador reseteado'); }
      else addToast('error', data.error || 'Error al resetear');
    } catch (e) { addToast('error', e.message); }
  }

  const isSupremeAdmin = user?.id === 'admin_001' || user?.username === 'admin';

  useEffect(() => { load(); }, []);
  useEffect(() => { if (refreshTrigger > 0) load(); }, [refreshTrigger]);
  useEffect(() => { load(); }, [page, filter, tfFilter, dateFrom, dateTo, perPage]);

  if (loading && !data) return <Loading text="Cargando simulador..." />;
  if (error && !data) return <div className="history-empty">Error: {error}</div>;
  if (!data) return null;

  const { overall, perToken, history, positions, pagination, filterStats } = data;

  const symbols = [...new Set([
    ...Object.keys(perToken || {}),
    ...(positions || []).map(p => p.symbol),
  ])];
  const timeframes = [...new Set([
    ...(positions || []).map(p => p.timeframe).filter(Boolean),
    ...history.map(t => t.timeframe).filter(Boolean),
  ])];

  const filteredPositions = positions || [];
  const pag = pagination || { page: 1, limit: 20, total: history.length, totalPages: 1 };
  const fStats = filterStats || { filteredPnl: 0, filteredTrades: 0, filteredWins: 0 };
  const filteredPnl = fStats.filteredPnl;
  const filteredTrades = fStats.filteredTrades;
  const filteredWins = fStats.filteredWins;

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
          <div style={{ marginTop: '0.75rem' }}>
            <SortableTable
              columns={[
                { key: 'symbol', label: 'Token', render: v => <strong>{v}</strong> },
                { key: 'timeframe', label: 'TF', render: v => <TfBadge tf={v} /> },
                { key: 'openedAt', label: 'Entrada', render: v => formatDate(v) },
                { key: 'entryPrice', label: 'P. Compra', render: v => formatPrice(v) },
                { key: 'currentPrice', label: 'P. Actual', render: v => v ? formatPrice(v) : '-' },
                { key: 'amount', label: 'Inversion', render: v => `$${v?.toFixed(2)}` },
                { key: 'rsi', label: 'RSI (Compra)', render: v => formatRSISummary(v) },
                { key: 'sma200', label: 'SMA 200', render: (_, row) => row.rsi?.sma200 != null ? formatPrice(row.rsi.sma200) : '-' },
                { key: 'pnl', label: 'P&L ($)', render: v => <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatPnl(v)}</span> },
                { key: 'pnlPct', label: 'P&L (%)', render: v => <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{v?.toFixed(2)}%</span> },
              ]}
              data={filteredPositions}
              emptyText="Sin posiciones abiertas"
            />
          </div>
        </div>
      )}

      {/* Trade History */}
      <div className="market-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 className="section-title" style={{ marginBottom: 0 }}>Historial de Operaciones</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
              <option value="ALL">Todos</option>
              {symbols.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={tfFilter} onChange={e => { setTfFilter(e.target.value); setPage(1); }} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
              <option value="ALL">Todos TF</option>
              {timeframes.map(tf => <option key={tf} value={tf}>{tf}</option>)}
            </select>
            <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
              <option value={20}>20/page</option>
              <option value={50}>50/page</option>
              <option value={100}>100/page</option>
            </select>
            <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Actualizar</button>
            {history.length > 0 && <>
              <button className="btn btn-secondary btn-sm" onClick={() => exportCSV(history)}>CSV</button>
              <button className="btn btn-secondary btn-sm" onClick={() => exportExcel(history)}>Excel</button>
            </>}
            {isSupremeAdmin && (
              <button className="btn btn-sm" onClick={resetSimulator} disabled={loading}
                style={{ color: 'var(--red)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                Resetear
              </button>
            )}
          </div>
        </div>

        {/* Date filters */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Fecha:</span>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>a</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
            style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }} />
          {['today', 'week', 'month', '3months', 'all'].map(p => (
            <button key={p} className="btn btn-sm" onClick={() => setDatePreset(p)}
              style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', background: 'var(--surface2)', color: 'var(--text-dim)', border: 'none', borderRadius: 4 }}>
              {{ today: 'Hoy', week: 'Semana', month: 'Mes', '3months': '3 Meses', all: 'Todo' }[p]}
            </button>
          ))}
        </div>

        {(filter !== 'ALL' || tfFilter !== 'ALL' || dateFrom || dateTo) && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
            {filter !== 'ALL' && `${filter}: `}
            {tfFilter !== 'ALL' && `TF ${tfFilter} | `}
            {filteredTrades} ops | Win rate: {filteredTrades > 0 ? `${((filteredWins / filteredTrades) * 100).toFixed(0)}%` : '-'} | P&L: <span style={{ color: filteredPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatPnl(filteredPnl)}</span>
          </div>
        )}

        {history.length === 0 ? (
          <div className="history-empty">Sin operaciones cerradas{(filter !== 'ALL' || tfFilter !== 'ALL' || dateFrom || dateTo) ? ` para este filtro` : ''}.</div>
        ) : (
          <>
            <SortableTable
              columns={[
                { key: 'symbol', label: 'Token', render: v => <strong>{v}</strong> },
                { key: 'timeframe', label: 'TF', render: v => <TfBadge tf={v} /> },
                { key: 'openedAt', label: 'Apertura', render: v => formatDate(v) },
                { key: 'closedAt', label: 'Cierre', render: v => formatDate(v) },
                { key: 'duration', label: 'Duracion', render: (_, row) => formatDuration(row.openedAt, row.closedAt) },
                { key: 'entryPrice', label: 'P. Compra', render: v => formatPrice(v) },
                { key: 'exitPrice', label: 'P. Venta', render: v => formatPrice(v) },
                { key: 'amount', label: 'Inversion', render: v => `$${v?.toFixed(2)}` },
                { key: 'rsi', label: 'RSI (Compra)', render: v => formatRSISummary(v) },
                { key: 'rsiClose', label: 'RSI (Venta)', render: v => formatRSISummary(v) },
                { key: 'sma200', label: 'SMA 200', render: (_, row) => row.rsi?.sma200 != null ? formatPrice(row.rsi.sma200) : '-' },
                { key: 'pnl', label: 'P&L ($)', render: v => <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{formatPnl(v)}</span> },
                { key: 'pnlPct', label: 'P&L (%)', render: v => <span style={{ color: v >= 0 ? 'var(--green)' : 'var(--red)' }}>{v?.toFixed(2)}%</span> },
              ]}
              data={[...history].reverse()}
              emptyText="Sin operaciones cerradas"
            />

            {/* Pagination */}
            {pag.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '1rem', fontSize: '0.85rem' }}>
                <button className="btn btn-sm btn-secondary" disabled={pag.page <= 1} onClick={() => { setPage(pag.page - 1); load(); }}>
                  &larr; Anterior
                </button>
                <span style={{ color: 'var(--text-dim)' }}>
                  Pag {pag.page} de {pag.totalPages} ({pag.total} ops)
                </span>
                <button className="btn btn-sm btn-secondary" disabled={pag.page >= pag.totalPages} onClick={() => { setPage(pag.page + 1); load(); }}>
                  Siguiente &rarr;
                </button>
              </div>
            )}
          </>
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
  if (rsi.rsi15m != null) parts.push(`15m:${rsi.rsi15m.toFixed(1)}`);
  if (rsi.rsi1h != null) parts.push(`1h:${rsi.rsi1h.toFixed(1)}`);
  if (rsi.rsi4h != null) parts.push(`4h:${rsi.rsi4h.toFixed(1)}`);
  if (rsi.rsi1d != null) parts.push(`1d:${rsi.rsi1d.toFixed(1)}`);
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
  { key: 'entryPrice', label: 'Precio Compra', fmt: v => v != null ? formatPrice(v).replace('$', '') : '' },
  { key: 'exitPrice', label: 'Precio Venta', fmt: v => v != null ? formatPrice(v).replace('$', '') : '' },
  { key: 'amount', label: 'Inversion ($)', fmt: v => v?.toFixed(2) || '' },
  { key: 'exitValue', label: 'Valor Salida ($)', fmt: v => v?.toFixed(2) || '' },
  { key: 'quantity', label: 'Cantidad', fmt: v => v?.toFixed(6) || '' },
  { key: 'rsiOpen15m', label: 'RSI 15m (Compra)', fmt: (_, t) => t.rsi?.rsi15m?.toFixed(1) || t.rsiAtOpen?.toFixed(1) || '' },
  { key: 'rsiOpen1h', label: 'RSI 1h (Compra)', fmt: (_, t) => t.rsi?.rsi1h?.toFixed(1) || '' },
  { key: 'rsiOpen4h', label: 'RSI 4h (Compra)', fmt: (_, t) => t.rsi?.rsi4h?.toFixed(1) || '' },
  { key: 'rsiOpen1d', label: 'RSI 1d (Compra)', fmt: (_, t) => t.rsi?.rsi1d?.toFixed(1) || '' },
  { key: 'sma200', label: 'SMA 200 (Compra)', fmt: (_, t) => t.rsi?.sma200 != null ? formatPrice(t.rsi.sma200) : '' },
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
