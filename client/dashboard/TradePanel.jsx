import { useState } from 'react';
import { formatPrice } from './TokenCard';

export default function TradePanel({ symbol, position, onTrade }) {
  const [amount, setAmount] = useState(100);
  const [loading, setLoading] = useState(false);

  async function buy() {
    setLoading(true);
    try {
      const res = await fetch('/api/trade/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, amount }),
      });
      const data = await res.json();
      if (!data.success) alert(data.message);
      onTrade();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setLoading(false); }
  }

  async function sell() {
    if (!confirm(`¿Vender posición de ${symbol}?`)) return;
    setLoading(true);
    try {
      const res = await fetch('/api/trade/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (data.success) {
        const t = data.trade;
        const s = t.pnl >= 0 ? '+' : '';
        alert(`${t.symbol} vendido!\nEntrada: ${formatPrice(t.entryPrice)}\nSalida: ${formatPrice(t.exitPrice)}\nPnL: ${s}$${t.pnl.toFixed(2)} (${s}${t.pnlPct.toFixed(2)}%)`);
      } else { alert(data.message); }
      onTrade();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setLoading(false); }
  }

  if (!position) {
    return (
      <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--surface2)' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input type="number" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 100)}
            style={{ width: 80, fontSize: '0.8rem', padding: '0.35rem 0.5rem' }} min="1" step="10" />
          <button className="btn btn-green btn-sm" onClick={buy} disabled={loading}>Comprar</button>
        </div>
      </div>
    );
  }

  const pnl = position.pnl || 0;
  const pnlPct = position.pnlPct || 0;
  const isNeg = pnl < 0;

  return (
    <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--surface2)' }}>
      <div style={{
        padding: '0.6rem', borderRadius: 8,
        background: isNeg ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
        border: `1px solid ${isNeg ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
      }}>
        <Row label="Entrada" value={`${formatPrice(position.entryPrice)} (RSI: ${position.rsiAtOpen?.toFixed(1) || 'N/A'})`} />
        <Row label="Actual" value={formatPrice(position.currentPrice)} />
        <Row label="Invertido" value={`$${position.amount.toFixed(2)}`} />
        <Row label="PnL" value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)`}
          className={isNeg ? 'pnl-negative' : 'pnl-positive'} />
        <Row label="Abierto" value={timeAgo(position.openedAt)} dim />
      </div>
      <div style={{ marginTop: '0.5rem' }}>
        <button className="btn btn-danger btn-sm" onClick={sell} disabled={loading}>Vender</button>
      </div>
    </div>
  );
}

function Row({ label, value, className, dim }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', lineHeight: 1.6 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span className={className} style={{ fontWeight: 600, fontSize: dim ? '0.7rem' : undefined, color: dim ? 'var(--text-dim)' : undefined }}>{value}</span>
    </div>
  );
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `hace ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}
