export default function RSIGauge({ rsi, timeframe }) {
  if (rsi === null || rsi === undefined) return <span style={{ color: 'var(--text-dim)' }}>N/A</span>;

  const color = getRSIArcColor(rsi);
  const pct = rsi / 100;
  const r = 32;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;

  return (
    <div style={{ position: 'relative', width: 80, height: 80 }}>
      <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="40" cy="40" r={r} fill="none" stroke="#334155" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: getRSIColor(rsi) }}>
          {rsi.toFixed(1)}
        </div>
        {timeframe && (
          <div style={{ fontSize: '0.55rem', color: 'var(--text-dim)', marginTop: -2 }}>
            {timeframe}
          </div>
        )}
      </div>
    </div>
  );
}

function getRSIArcColor(rsi) {
  if (rsi >= 70) return '#ef4444';
  if (rsi >= 60) return '#eab308';
  if (rsi <= 30) return '#22c55e';
  if (rsi <= 40) return '#f97316';
  return '#6b7280';
}

function getRSIColor(rsi) {
  if (rsi >= 70) return 'var(--red)';
  if (rsi >= 60) return 'var(--yellow)';
  if (rsi <= 30) return 'var(--green)';
  if (rsi <= 40) return 'var(--orange)';
  return 'var(--gray)';
}
