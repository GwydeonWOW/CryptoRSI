export default function FundingChart({ data }) {
  if (!data || data.length === 0) return <div className="history-empty">Sin datos</div>;

  const maxAbs = Math.max(...data.map(d => Math.abs(d.rate)), 0.0001);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: 4 }}>
        <span>Hace {data.length} periodos</span><span>Ahora</span>
      </div>
      <div className="mini-chart-container">
        {data.map((d, i) => {
          const h = (Math.abs(d.rate) / maxAbs) * 100;
          return <div key={i} className="mini-bar" style={{ height: `${Math.max(h, 3)}%`, background: d.rate >= 0 ? '#ef4444' : '#22c55e' }}
            data-value={`${(d.rate * 100).toFixed(4)}%`} />;
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginTop: 4 }}>
        <span style={{ color: 'var(--green)' }}>Negativo = Shorts pagan</span>
        <span style={{ color: 'var(--red)' }}>Positivo = Longs pagan</span>
      </div>
    </div>
  );
}
