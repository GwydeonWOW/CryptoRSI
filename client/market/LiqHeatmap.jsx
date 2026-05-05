import { formatPrice } from '../dashboard/TokenCard';

export default function LiqHeatmap({ zones, currentPrice }) {
  if (!zones || !currentPrice) return <div className="history-empty">Datos no disponibles</div>;

  const longZones = zones.longZones || [];
  const shortZones = zones.shortZones || [];
  const allZones = [...longZones, ...shortZones];
  const maxVol = Math.max(...allZones.map(z => z.volume), 1);

  const prices = allZones.map(z => z.liqPrice);
  const minPrice = Math.min(...prices, currentPrice) * 0.998;
  const maxPrice = Math.max(...prices, currentPrice) * 1.002;
  const priceRange = maxPrice - minPrice || 1;

  const chartH = 280;
  const chartW = 300;
  const barH = 22;
  const labelW = 52;
  const priceW = 100;

  function priceToY(price) {
    return chartH - ((price - minPrice) / priceRange) * chartH;
  }

  const currentY = priceToY(currentPrice);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', marginRight: 4, verticalAlign: 'middle' }}></span>Liquidacion Longs</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', marginRight: 4, verticalAlign: 'middle' }}></span>Liquidacion Shorts</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 0' }}>
        <svg width={labelW + chartW + priceW} height={chartH + 20} style={{ overflow: 'visible' }}>
          {/* Price grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(frac => {
            const y = frac * chartH;
            const p = maxPrice - frac * priceRange;
            return (
              <g key={frac}>
                <line x1={labelW} y1={y} x2={labelW + chartW} y2={y} stroke="var(--surface2)" strokeWidth="0.5" strokeDasharray="3,3" />
                <text x={labelW - 6} y={y + 3} textAnchor="end" fill="var(--text-dim)" fontSize="8">{formatPrice(p)}</text>
              </g>
            );
          })}

          {/* Current price line */}
          <line x1={labelW} y1={currentY} x2={labelW + chartW} y2={currentY} stroke="var(--blue)" strokeWidth="1.5" />
          <rect x={labelW + chartW + 4} y={currentY - 8} width={priceW - 4} height={16} rx={3} fill="rgba(59,130,246,0.15)" stroke="var(--blue)" strokeWidth="0.5" />
          <text x={labelW + chartW + 8} y={currentY + 3} fill="var(--blue)" fontSize="9" fontWeight="600">
            {formatPrice(currentPrice)}
          </text>

          {/* Zone labels and bars */}
          {longZones.map((zone, i) => {
            const y = priceToY(zone.liqPrice);
            const intensity = Math.max(zone.volume / maxVol, 0.15);
            const barW = Math.max((zone.volume / maxVol) * chartW * 0.7, 30);
            const offset = ((zone.liqPrice - currentPrice) / currentPrice) * 100;

            return (
              <g key={`l${i}`}>
                <rect x={labelW} y={y - barH / 2} width={barW} height={barH} rx={3}
                  fill={`rgba(239,68,68,${intensity * 0.6 + 0.1})`} stroke="rgba(239,68,68,0.3)" strokeWidth="0.5" />
                <text x={labelW + 5} y={y + 3} fill="white" fontSize="8" fontWeight="500">{zone.leverage}x</text>
                <text x={labelW + chartW + 8} y={y + 3} fill="var(--text-dim)" fontSize="8">
                  {formatPrice(zone.liqPrice)} <tspan fill="var(--red)" fontSize="7">({offset.toFixed(1)}%)</tspan>
                </text>
              </g>
            );
          })}

          {shortZones.map((zone, i) => {
            const y = priceToY(zone.liqPrice);
            const intensity = Math.max(zone.volume / maxVol, 0.15);
            const barW = Math.max((zone.volume / maxVol) * chartW * 0.7, 30);
            const offset = ((zone.liqPrice - currentPrice) / currentPrice) * 100;

            return (
              <g key={`s${i}`}>
                <rect x={labelW} y={y - barH / 2} width={barW} height={barH} rx={3}
                  fill={`rgba(34,197,94,${intensity * 0.6 + 0.1})`} stroke="rgba(34,197,94,0.3)" strokeWidth="0.5" />
                <text x={labelW + 5} y={y + 3} fill="white" fontSize="8" fontWeight="500">{zone.leverage}x</text>
                <text x={labelW + chartW + 8} y={y + 3} fill="var(--text-dim)" fontSize="8">
                  {formatPrice(zone.liqPrice)} <tspan fill="var(--green)" fontSize="7">(+{offset.toFixed(1)}%)</tspan>
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
