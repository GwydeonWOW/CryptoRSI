import { formatPrice } from '../dashboard/TokenCard';

export default function LiqHeatmap({ zones, currentPrice }) {
  if (!zones || !currentPrice) return <div className="history-empty">Datos no disponibles</div>;

  const allZones = [
    ...zones.longZones.map(z => ({ ...z, label: `Long ${z.leverage}x` })),
    ...zones.shortZones.map(z => ({ ...z, label: `Short ${z.leverage}x` })),
  ].sort((a, b) => a.liqPrice - b.liqPrice);

  const maxVol = Math.max(...allZones.map(z => z.volume), 1);

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
        <span style={{ color: 'var(--blue)', fontWeight: 600 }}>Precio actual: {formatPrice(currentPrice)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '1rem 0' }}>
        {allZones.map((zone, i) => {
          const widthPct = Math.min((zone.volume / maxVol) * 100, 100);
          const priceOffset = ((zone.liqPrice - currentPrice) / currentPrice) * 100;
          const isAbove = zone.liqPrice >= currentPrice;
          const fillColor = zone.side === 'long' ? 'rgba(239,68,68,0.7)' : 'rgba(34,197,94,0.7)';

          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', width: 35, textAlign: 'right', flexShrink: 0 }}>{zone.label}</span>
              <div style={{ flex: 1, height: 16, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${widthPct}%`, background: fillColor }} />
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', width: 100, flexShrink: 0 }}>
                {formatPrice(zone.liqPrice)} <span style={{ color: isAbove ? 'var(--green)' : 'var(--red)', fontSize: '0.6rem' }}>({priceOffset >= 0 ? '+' : ''}{priceOffset.toFixed(1)}%)</span>
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.7rem', color: 'var(--text-dim)', flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', marginRight: 4 }}></span>Liquidacion de Longs</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', marginRight: 4 }}></span>Liquidacion de Shorts</span>
      </div>
    </div>
  );
}
