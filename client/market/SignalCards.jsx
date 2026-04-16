export default function SignalCards({ signals }) {
  if (!signals || signals.length === 0) return null;

  return (
    <div className="signal-grid">
      {signals.map((s, i) => (
        <div key={i} className={`signal-card ${s.signal}`} style={{
          background: 'var(--surface)', borderRadius: 10, padding: '1rem',
          border: '1px solid var(--surface2)', borderLeft: `4px solid ${getBorderColor(s.signal)}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{s.indicator}</span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 500, padding: '0.15rem 0.5rem', borderRadius: 4, background: 'var(--surface2)' }}>{s.value}</span>
              <span className={`signal-badge ${s.signal}`} style={{
                fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase',
                padding: '0.15rem 0.4rem', borderRadius: 3, letterSpacing: '0.03em',
                background: getBadgeBg(s.signal), color: getBadgeColor(s.signal),
              }}>{s.signal.replace('-', ' ')}</span>
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.4 }}>{s.reason}</div>
        </div>
      ))}
    </div>
  );
}

function getBorderColor(signal) {
  const map = { bullish: 'var(--green)', bearish: 'var(--red)', 'neutral-bull': '#86efac', 'neutral-bear': '#fdba74', neutral: 'var(--gray)' };
  return map[signal] || 'var(--gray)';
}
function getBadgeBg(signal) {
  const map = { bullish: 'rgba(34,197,94,0.15)', bearish: 'rgba(239,68,68,0.15)', neutral: 'rgba(107,114,128,0.15)', 'neutral-bull': 'rgba(34,197,94,0.1)', 'neutral-bear': 'rgba(249,115,22,0.1)' };
  return map[signal] || 'rgba(107,114,128,0.15)';
}
function getBadgeColor(signal) {
  const map = { bullish: 'var(--green)', bearish: 'var(--red)', neutral: 'var(--gray)', 'neutral-bull': '#86efac', 'neutral-bear': '#fdba74' };
  return map[signal] || 'var(--gray)';
}
