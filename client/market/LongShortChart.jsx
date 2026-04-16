export default function LongShortChart({ data, topData }) {
  if (!data || data.length === 0) return <div className="history-empty">Sin datos</div>;

  const topInfo = topData && topData.length > 0 ? topData[topData.length - 1] : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: 4 }}>
        <span>Hace {data.length} periodos</span><span>Ahora</span>
      </div>
      <div className="mini-chart-container">
        {data.map((d, i) => {
          const h = (d.longs / (d.longs + d.shorts)) * 100;
          const c = d.ratio > 1.2 ? '#22c55e' : d.ratio < 0.8 ? '#ef4444' : '#eab308';
          return <div key={i} className="mini-bar" style={{ height: `${h}%`, background: c }}
            data-value={`L:${(d.longs*100).toFixed(0)}% S:${(d.shorts*100).toFixed(0)}%`} />;
        })}
      </div>
      {topInfo && (
        <div style={{ marginTop: 6, fontSize: '0.75rem' }}>
          Top Traders: <span style={{ color: 'var(--green)' }}>{(topInfo.longs*100).toFixed(0)}% Long</span> / <span style={{ color: 'var(--red)' }}>{(topInfo.shorts*100).toFixed(0)}% Short</span> (ratio: {topInfo.ratio.toFixed(2)})
        </div>
      )}
    </div>
  );
}
