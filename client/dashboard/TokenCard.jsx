import RSIGauge from './RSIGauge';
import RSIChart from './RSIChart';
import { useState } from 'react';
import { getAuthHeaders } from '../hooks/useAPI';

export default function TokenCard({ data, onRefresh, isAdmin }) {
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
  const primaryTF = data.primaryTimeframe || '1d';
  const rec = data.recommendation || {};
  const divergence = data.divergence;
  const activeTimeframes = Object.entries(data.timeframes || {}).filter(([_, v]) => v.rsi !== null);

  async function removeToken(symbol) {
    if (!confirm(`Eliminar ${symbol} de los tokens trackeados?`)) return;
    try {
      const res = await fetch(`/api/tokens/${symbol}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) onRefresh();
      else alert(data.message || 'Error al eliminar');
    } catch (e) { alert('Error: ' + e.message); }
  }

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 12,
      padding: '1.25rem',
      border: `1px solid ${
        divergence?.bullish ? 'var(--green)' :
        divergence?.bearish ? 'var(--red)' :
        'var(--surface2)'
      }`,
      position: 'relative',
      transition: 'border-color 0.2s',
    }}>
      {/* Divergence badge */}
      {divergence && (divergence.bullish || divergence.bearish) && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700,
          background: divergence.bullish ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: divergence.bullish ? 'var(--green)' : 'var(--red)',
          border: `1px solid ${divergence.bullish ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          {divergence.bullish ? 'BULL DIV' : 'BEAR DIV'}
          {divergence.strength !== 'weak' ? ` (${divergence.strength === 'strong' ? 'fuerte' : 'normal'})` : ''}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
            <a href={`https://www.tradingview.com/chart/?symbol=BINANCE:${data.symbol}USDT`} target="_blank" rel="noopener noreferrer"
              className="tv-link">
              {data.symbol} <span style={{ fontSize: '0.6rem', opacity: 0.5 }}>&#8599;</span>
            </a>
          </h3>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{data.name || ''}</div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>{formatPrice(data.price)}</div>
          {isAdmin && (
            <button onClick={() => removeToken(data.symbol)} title="Eliminar token"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', fontSize: '1rem', padding: 2, lineHeight: 1,
              }}>&times;</button>
          )}
        </div>
      </div>

      {/* RSI Gauge + Timeframe tabs */}
      {activeTimeframes.length > 0 ? (
        <TokenTimeframes timeframes={activeTimeframes} primaryRSI={primaryRSI} primaryTF={primaryTF} rec={rec} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <RSIGauge rsi={primaryRSI} timeframe={primaryTF} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: rec.color || 'inherit' }}>{rec.label || 'N/A'}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{rec.reason || ''}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function TokenTimeframes({ timeframes, primaryRSI, primaryTF, rec }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [_, tfData] = timeframes[activeIdx] || [];
  const activeRSI = tfData?.rsi ?? primaryRSI;
  const activeTF = timeframes[activeIdx]?.[0] || primaryTF;

  let label, reason, recColor;
  if (activeRSI <= 20) { label = 'Sobreventa Extrema'; reason = 'RSI muy bajo, posible rebote fuerte'; recColor = 'var(--green)'; }
  else if (activeRSI <= 30) { label = 'Sobreventa'; reason = 'RSI en zona de sobreventa'; recColor = 'var(--green)'; }
  else if (activeRSI <= 40) { label = 'Zona de compra'; reason = 'RSI bajando, posible oportunidad'; recColor = 'var(--orange)'; }
  else if (activeRSI <= 60) { label = 'Neutral'; reason = 'RSI en zona neutral'; recColor = 'var(--text-dim)'; }
  else if (activeRSI <= 70) { label = 'Zona de venta'; reason = 'RSI subiendo, precaucion'; recColor = 'var(--yellow)'; }
  else if (activeRSI <= 80) { label = 'Sobrecompra'; reason = 'RSI en zona de sobrecompra'; recColor = 'var(--red)'; }
  else { label = 'Sobrecompra Extrema'; reason = 'RSI muy alto, posible correccion'; recColor = 'var(--red)'; }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <RSIGauge rsi={activeRSI} timeframe={activeTF} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: recColor }}>{label}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{reason}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: '0.5rem' }}>
        {timeframes.map(([tf, d], i) => (
          <button key={tf} onClick={() => setActiveIdx(i)}
            style={{
              padding: '0.3rem 0.6rem', border: 'none', borderRadius: 4,
              background: i === activeIdx ? 'var(--surface2)' : 'transparent',
              color: i === activeIdx ? 'var(--text)' : 'var(--text-dim)',
              cursor: 'pointer', fontSize: '0.75rem', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 4,
              whiteSpace: 'nowrap',
            }}>
            {tf} <span style={{ color: getRSIColor(d.rsi) }}>{d.rsi?.toFixed(1)}</span>
            {d.divergence?.bullish && <span style={{ color: 'var(--green)', fontSize: '0.55rem', fontWeight: 600 }}>-B</span>}
            {d.divergence?.bearish && <span style={{ color: 'var(--red)', fontSize: '0.55rem', fontWeight: 600 }}>-S</span>}
          </button>
        ))}
      </div>
      <RSIChart history={timeframes[activeIdx]?.[1]?.rsiHistory || []} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-dim)' }}>
        <span style={{ color: 'var(--green)' }}>30</span><span>50</span><span style={{ color: 'var(--red)' }}>70</span>
      </div>
    </>
  );
}

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
