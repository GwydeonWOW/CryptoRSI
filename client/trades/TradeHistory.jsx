import { useState, useEffect } from 'react';
import { useAuthAPI } from '../hooks/useAPI';
import Loading from '../components/Loading';

export default function TradeHistory({ refreshTrigger }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('ALL');
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
  const filtered = filter === 'ALL' ? history : history.filter(t => t.symbol === filter);
  const filteredPositions = filter === 'ALL' ? positions : positions.filter(p => p.symbol === filter);

  const filteredPnl = filtered.reduce((s, t) => s + t.pnl, 0);
  const filteredTrades = filtered.length;
  const filteredWins = filtered.filter(t => t.pnl > 0).length;

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
              <TokenSummary key={sym} symbol={sym} stats={perToken[sym]} active={filter === sym} onClick={() => setFilter(filter === sym ? 'ALL' : sym)} />
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
                  <th style={thStyle}>Entrada</th>
                  <th style={thStyle}>Precio Compra</th>
                  <th style={thStyle}>Precio Actual</th>
                  <th style={thStyle}>Inversion</th>
                  <th style={thStyle}>RSI Compra</th>
                  <th style={thStyle}>P&L</th>
                  <th style={thStyle}>P&L %</th>
                </tr>
              </thead>
              <tbody>
                {filteredPositions.map(pos => (
                  <tr key={pos.id}>
                    <td style={tdStyle}><strong>{pos.symbol}</strong></td>
                    <td style={tdStyle}>{formatDate(pos.openedAt)}</td>
                    <td style={tdStyle}>${pos.entryPrice?.toFixed(2)}</td>
                    <td style={tdStyle}>{pos.currentPrice ? `$${pos.currentPrice.toFixed(2)}` : '-'}</td>
                    <td style={tdStyle}>${pos.amount?.toFixed(2)}</td>
                    <td style={tdStyle}>{pos.rsiAtOpen?.toFixed(1) || '-'}</td>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 className="section-title" style={{ marginBottom: 0 }}>Historial de Operaciones</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Filtrar:</span>
            <select value={filter} onChange={e => setFilter(e.target.value)} style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
              <option value="ALL">Todos</option>
              {symbols.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>Actualizar</button>
          </div>
        </div>

        {filter !== 'ALL' && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
            {filter}: {filteredTrades} ops | Win rate: {filteredTrades > 0 ? `${((filteredWins / filteredTrades) * 100).toFixed(0)}%` : '-'} | P&L: <span style={{ color: filteredPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatPnl(filteredPnl)}</span>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="history-empty">Sin operaciones cerradas{filter !== 'ALL' ? ` para ${filter}` : ''}.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Token</th>
                  <th style={thStyle}>Compra</th>
                  <th style={thStyle}>Venta</th>
                  <th style={thStyle}>Precio Compra</th>
                  <th style={thStyle}>Precio Venta</th>
                  <th style={thStyle}>Inversion</th>
                  <th style={thStyle}>RSI Compra</th>
                  <th style={thStyle}>RSI Venta</th>
                  <th style={thStyle}>P&L</th>
                  <th style={thStyle}>P&L %</th>
                </tr>
              </thead>
              <tbody>
                {[...filtered].reverse().map((t, i) => (
                  <tr key={i}>
                    <td style={tdStyle}><strong>{t.symbol}</strong></td>
                    <td style={tdStyle}>{formatDate(t.openedAt)}</td>
                    <td style={tdStyle}>{formatDate(t.closedAt)}</td>
                    <td style={tdStyle}>${t.entryPrice?.toFixed(2)}</td>
                    <td style={tdStyle}>${t.exitPrice?.toFixed(2)}</td>
                    <td style={tdStyle}>${t.amount?.toFixed(2)}</td>
                    <td style={tdStyle}>{t.rsiAtOpen?.toFixed(1) || '-'}</td>
                    <td style={tdStyle}>{t.rsiAtClose?.toFixed(1) || '-'}</td>
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

function formatPnl(val) {
  if (val === null || val === undefined) return '-';
  return val >= 0 ? `+$${val.toFixed(2)}` : `-$${Math.abs(val).toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' };
const thStyle = { textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid var(--surface2)', color: 'var(--text-dim)', fontWeight: 500, fontSize: '0.7rem', textTransform: 'uppercase', whiteSpace: 'nowrap' };
const tdStyle = { padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--surface2)', whiteSpace: 'nowrap' };
