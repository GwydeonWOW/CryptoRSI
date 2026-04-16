export default function OpenInterestChart({ data }) {
  if (!data || data.length === 0) return <div className="history-empty">Sin datos</div>;

  const maxOI = Math.max(...data.map(d => d.sumOpenInterestValue));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: 4 }}>
        <span>Hace {data.length} periodos</span><span>Ahora</span>
      </div>
      <div className="mini-chart-container">
        {data.map((d, i) => {
          const h = (d.sumOpenInterestValue / maxOI) * 100;
          return <div key={i} className="mini-bar" style={{ height: `${h}%`, background: 'var(--blue)' }}
            data-value={`$${(d.sumOpenInterestValue/1e6).toFixed(1)}M`} />;
        })}
      </div>
      <div style={{ fontSize: '0.75rem', marginTop: 4 }}>
        OI actual: <strong>${(data[data.length-1].sumOpenInterestValue/1e6).toFixed(1)}M</strong>
      </div>
    </div>
  );
}
