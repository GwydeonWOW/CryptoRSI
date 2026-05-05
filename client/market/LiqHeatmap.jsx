import { formatPrice } from '../dashboard/TokenCard';

export default function LiqHeatmap({ zones, currentPrice }) {
  if (!zones || !currentPrice) return <div className="history-empty">Datos no disponibles</div>;

  const bids = zones.orderBook?.bidDepth || [];
  const asks = zones.orderBook?.askDepth || [];

  if (bids.length === 0 && asks.length === 0) {
    return <div className="history-empty">Datos de order book no disponibles</div>;
  }

  // Aggregate into ~12 buckets each side
  const BUCKETS = 12;
  const bidBuckets = bucketDepth(bids, BUCKETS, 'desc');
  const askBuckets = bucketDepth(asks, BUCKETS, 'asc');

  // Cumulative volumes
  let cumBid = 0;
  const bidRows = bidBuckets.map(b => { cumBid += b.totalQty; return { ...b, cumVol: cumBid }; });
  let cumAsk = 0;
  const askRows = askBuckets.map(b => { cumAsk += b.totalQty; return { ...b, cumVol: cumAsk }; });

  const maxCum = Math.max(cumBid, cumAsk, 1);

  return (
    <div>
      {/* Current price */}
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--blue)' }}>
          {formatPrice(currentPrice)}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginLeft: 8 }}>precio actual</span>
      </div>

      {/* Depth chart */}
      <div style={{ display: 'flex', gap: 0, width: '100%', marginBottom: '0.5rem' }}>
        {/* Bids (green) - left side */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.35rem', textAlign: 'center' }}>
            Compras (Bids)
          </div>
          {bidRows.map((row, i) => {
            const pct = (row.cumVol / maxCum) * 100;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 2 }}>
                <div style={{ flex: 1, height: 22, position: 'relative' }}>
                  <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: `${pct}%`,
                    background: 'rgba(34,197,94,0.25)', borderRadius: 3 }} />
                  <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: `${pct}%`, maxWidth: 3,
                    background: 'rgba(34,197,94,0.6)', borderRadius: 3 }} />
                  <div style={{ position: 'relative', zIndex: 1, fontSize: '0.75rem', fontWeight: 500, color: 'var(--green)',
                    padding: '2px 8px', textAlign: 'right' }}>
                    {formatPrice(row.avgPrice)}
                  </div>
                </div>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', width: 55, textAlign: 'right', flexShrink: 0 }}>
                  {row.totalQty.toFixed(2)} BTC
                </span>
              </div>
            );
          })}
        </div>

        {/* Asks (red) - right side */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.35rem', textAlign: 'center' }}>
            Ventas (Asks)
          </div>
          {askRows.map((row, i) => {
            const pct = (row.cumVol / maxCum) * 100;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 2 }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', width: 55, textAlign: 'right', flexShrink: 0 }}>
                  {row.totalQty.toFixed(2)} BTC
                </span>
                <div style={{ flex: 1, height: 22, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`,
                    background: 'rgba(239,68,68,0.25)', borderRadius: 3 }} />
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, maxWidth: 3,
                    background: 'rgba(239,68,68,0.6)', borderRadius: 3 }} />
                  <div style={{ position: 'relative', zIndex: 1, fontSize: '0.75rem', fontWeight: 500, color: 'var(--red)',
                    padding: '2px 8px' }}>
                    {formatPrice(row.avgPrice)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Totals */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-dim)',
        borderTop: '1px solid var(--surface2)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
        <span>Total bids: <strong style={{ color: 'var(--green)' }}>{zones.orderBook?.totalBidVol?.toFixed(2) || '-'} BTC</strong></span>
        <span>Total asks: <strong style={{ color: 'var(--red)' }}>{zones.orderBook?.totalAskVol?.toFixed(2) || '-'} BTC</strong></span>
      </div>
    </div>
  );
}

function bucketDepth(orders, numBuckets, sortDir) {
  if (!orders.length) return [];
  const allPrices = orders.map(o => o.price);
  const low = Math.min(...allPrices);
  const high = Math.max(...allPrices);
  const range = high - low || 1;
  const step = range / numBuckets;

  const buckets = [];
  for (let i = 0; i < numBuckets; i++) {
    const from = sortDir === 'asc' ? low + i * step : high - i * step;
    const to = sortDir === 'asc' ? low + (i + 1) * step : high - (i + 1) * step;
    const inBucket = orders.filter(o => sortDir === 'asc' ? o.price >= from && o.price < to : o.price <= from && o.price > to);
    const totalQty = inBucket.reduce((s, o) => s + o.qty, 0);
    if (totalQty > 0) {
      const avgPrice = inBucket.reduce((s, o) => s + o.price, 0) / inBucket.length;
      buckets.push({ avgPrice, totalQty });
    }
  }
  return buckets;
}
