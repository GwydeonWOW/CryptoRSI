import { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import Loading from '../components/Loading';
import { formatPrice } from '../dashboard/TokenCard';

export default function TradeHistory({ refreshTrigger }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (refreshTrigger <= 0) return;
    async function load() {
      setLoading(true);
      try {
        const [s, h] = await Promise.all([useAPI('/api/trade/stats'), useAPI('/api/trade/history')]);
        setStats(s);
        setHistory(h);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, [refreshTrigger]);

  if (loading) return <Loading text="Cargando historial..." />;
  if (!stats) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
      <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Sin datos de trades</p>
      <p style={{ fontSize: '0.75rem' }}>Pulsa "Actualizar" para cargar el historial.</p>
    </div>
  );

  return (
    <div>
      <div className="stats-grid">
        <StatCard label="Total Trades" value={stats.totalTrades} />
        <StatCard label="Win Rate" value={`${stats.winRate.toFixed(0)}%`} color={stats.winRate >= 50 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="PnL Total" value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`} color={stats.totalPnl >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="PnL Medio" value={`${stats.avgPnlPct >= 0 ? '+' : ''}${stats.avgPnlPct.toFixed(2)}%`} color={stats.avgPnlPct >= 0 ? 'var(--green)' : 'var(--red)'} />
        <StatCard label="Wins / Losses" value={<><span style={{ color: 'var(--green)' }}>{stats.wins}</span> / <span style={{ color: 'var(--red)' }}>{stats.losses}</span></>} />
        <StatCard label="Mejor Trade" value={stats.bestTrade ? formatPnl(stats.bestTrade.pnl, stats.bestTrade.pnlPct) + ` (${stats.bestTrade.symbol})` : 'N/A'} valueStyle={{ fontSize: '1rem' }} />
      </div>

      {history.length === 0 ? (
        <div className="history-empty">Aún no hay trades cerrados. Abre posiciones desde el Dashboard.</div>
      ) : (
        <table className="history-table">
          <thead>
            <tr><th>Token</th><th>Entrada</th><th>Salida</th><th>Invertido</th><th>PnL</th><th>Fecha</th></tr>
          </thead>
          <tbody>
            {history.sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt)).map((t, i) => (
              <tr key={i}>
                <td><strong>{t.symbol}</strong></td>
                <td>{formatPrice(t.entryPrice)} <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>(RSI:{t.rsiAtOpen?.toFixed(0) || '-'})</span></td>
                <td>{formatPrice(t.exitPrice)} <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>(RSI:{t.rsiAtClose?.toFixed(0) || '-'})</span></td>
                <td>${t.amount.toFixed(0)}</td>
                <td className={t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>
                  {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)} ({t.pnl >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%)
                </td>
                <td style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>{new Date(t.closedAt).toLocaleString('es-ES')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatCard({ label, value, color, valueStyle }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: color || 'inherit', ...valueStyle }}>{value}</div>
    </div>
  );
}

function formatPnl(pnl, pct) {
  const cls = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}$${pnl.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
}
