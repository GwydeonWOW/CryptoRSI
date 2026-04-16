export default function TakerVolumeChart({ data }) {
  if (!data || data.length === 0) return <div className="history-empty">Sin datos</div>;

  const maxRatio = Math.max(...data.map(d => d.ratio), 1.5);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: 4 }}>
        <span>Hace {data.length} periodos</span><span>Ahora</span>
      </div>
      <div className="mini-chart-container">
        {data.map((d, i) => {
          const h = (d.ratio / maxRatio) * 100;
          const c = d.ratio > 1 ? '#22c55e' : d.ratio < 1 ? '#ef4444' : '#eab308';
          return <div key={i} className="mini-bar" style={{ height: `${h}%`, background: c }}
            data-value={`Ratio: ${d.ratio.toFixed(2)}`} />;
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginTop: 4 }}>
        <span style={{ color: 'var(--red)' }}>Venta agresiva</span>
        <span style={{ color: 'var(--text-dim)' }}>1.0</span>
        <span style={{ color: 'var(--green)' }}>Compra agresiva</span>
      </div>
    </div>
  );
}
