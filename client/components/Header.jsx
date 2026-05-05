import { useState, useEffect } from 'react';

export default function Header({ onRefresh, refreshing, lastUpdated, user, onLogout, onProfile }) {
  return (
    <header style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--surface2)',
      padding: '1rem 2rem',
    }}>
      <div style={{
        maxWidth: 1100,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--blue)' }}>
          CryptoRSI <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: '0.9rem' }}>Seguimiento RSI Personal</span>
        </h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <BtcWidget />
          {lastUpdated && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Ultima actualizacion: {lastUpdated.toLocaleString('es-ES')}
            </span>
          )}
          <button className="btn btn-secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Actualizando...' : 'Actualizar'}
          </button>
          {user && (
            <>
              <button className="btn btn-sm" onClick={onProfile}
                style={{ color: 'var(--text)', background: 'rgba(59,130,246,0.1)' }}>
                {user.displayName || user.username}
                {user.role === 'admin' && <span style={{ color: 'var(--blue)', marginLeft: 4, fontSize: '0.65rem' }}>Admin</span>}
              </button>
              <button className="btn btn-sm" onClick={onLogout}
                style={{ color: 'var(--text-dim)', background: 'rgba(148,163,184,0.1)' }}>
                Salir
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function BtcWidget() {
  const [price, setPrice] = useState(null);
  const [sparkline, setSparkline] = useState([]);

  async function fetchPrice() {
    try {
      const res = await fetch('/api/btc-price');
      if (!res.ok) return;
      const data = await res.json();
      setPrice(data.price);
      setSparkline(data.sparkline || []);
    } catch {}
  }

  useEffect(() => {
    fetchPrice();
    const id = setInterval(fetchPrice, 60000);
    return () => clearInterval(id);
  }, []);

  if (price === null) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0.3rem 0.7rem', borderRadius: 8,
      background: 'rgba(247,147,26,0.08)', border: '1px solid rgba(247,147,26,0.2)',
    }}>
      <span style={{ fontSize: '0.7rem', color: '#f7931a', fontWeight: 600 }}>BTC</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
        ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      {sparkline.length > 1 && <MiniSparkline data={sparkline.map(s => s.price)} />}
    </div>
  );
}

function MiniSparkline({ data }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 60;
  const h = 20;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  const last = data[data.length - 1];
  const first = data[0];
  const color = last >= first ? '#22c55e' : '#ef4444';

  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}
