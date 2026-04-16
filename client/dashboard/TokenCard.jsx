import RSIGauge from './RSIGauge';
import RSIChart from './RSIChart';
import TradePanel from './TradePanel';

export default function TokenCard({ data, position, onRefresh }) {
  if (data.error) {
    return (
      <div className="token-card" style={{ background: 'var(--surface)', borderRadius: 12, padding: '1.25rem', border: '1px solid var(--surface2)' }}>
        <h3>{data.symbol}</h3>
        <div className="token-name">{data.name || ''}</div>
        <div className="token-error">Error: {data.error}</div>
      </div>
    );
  }

  const primaryRSI = data.primaryRSI;
  const rec = data.recommendation || {};
  const activeTimeframes = Object.entries(data.timeframes || {}).filter(([_, v]) => v.rsi !== null);
  const hasPosition = !!position;

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 12,
      padding: '1.25rem',
      border: `1px solid ${hasPosition ? 'var(--green)' : 'var(--surface2)'}`,
      position: 'relative',
      transition: 'border-color 0.2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
            {data.symbol} {hasPosition && <span style={{ color: 'var(--green)', fontSize: '0.7rem' }}>EN POSICION</span>}
          </h3>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{data.name || ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{formatPrice(data.price)}</div>
        </div>
      </div>

      {/* RSI Gauge + Recommendation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <RSIGauge rsi={primaryRSI} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: rec.color || 'inherit' }}>{rec.label || 'N/A'}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{rec.reason || ''}</div>
        </div>
      </div>

      {/* Timeframe tabs */}
      {activeTimeframes.length > 0 && <TimeframeTabs timeframes={activeTimeframes} />}

      {/* Trade panel */}
      <TradePanel symbol={data.symbol} position={position} onTrade={onRefresh} />
    </div>
  );
}

function TimeframeTabs({ timeframes }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [_, tfData] = timeframes[activeIdx] || [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: '0.5rem' }}>
        {timeframes.map(([tf, d], i) => (
          <button key={tf} onClick={() => setActiveIdx(i)}
            style={{
              padding: '0.3rem 0.6rem', border: 'none', borderRadius: 4,
              background: i === activeIdx ? 'var(--surface2)' : 'transparent',
              color: i === activeIdx ? 'var(--text)' : 'var(--text-dim)',
              cursor: 'pointer', fontSize: '0.75rem', fontWeight: 500,
            }}>
            {tf} <span style={{ color: getRSIColor(d.rsi) }}>{d.rsi?.toFixed(1)}</span>
          </button>
        ))}
      </div>
      <RSIChart history={timeframes[activeIdx]?.[1]?.rsiHistory || []} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-dim)' }}>
        <span style={{ color: 'var(--green)' }}>30</span><span>50</span><span style={{ color: 'var(--red)' }}>70</span>
      </div>
    </div>
  );
}

import { useState } from 'react';

function getRSIColor(rsi) {
  if (rsi >= 70) return '#ef4444';
  if (rsi >= 60) return '#eab308';
  if (rsi <= 30) return '#22c55e';
  if (rsi <= 40) return '#f97316';
  return '#6b7280';
}

export function formatPrice(price) {
  if (price === null || price === undefined) return 'N/A';
  if (price >= 1) return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 0.01) return '$' + price.toFixed(4);
  return '$' + price.toFixed(8);
}
