export default function RSIChart({ history }) {
  if (!history || history.length === 0) return null;

  return (
    <div style={{ height: 40, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
      {history.map((v, i) => {
        const h = (v / 100) * 40;
        const c = getBarColor(v);
        return <div key={i} style={{ flex: 1, minWidth: 4, height: h, borderRadius: '2px 2px 0 0', background: c, transition: 'height 0.3s' }}
          title={`RSI: ${v.toFixed(1)}`} />;
      })}
    </div>
  );
}

function getBarColor(v) {
  if (v >= 70) return '#ef4444';
  if (v >= 60) return '#eab308';
  if (v <= 30) return '#22c55e';
  if (v <= 40) return '#f97316';
  return '#6b7280';
}
