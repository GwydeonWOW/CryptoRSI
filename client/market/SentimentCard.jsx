export default function SentimentCard({ sentiment, price }) {
  if (!sentiment) return null;
  const pct = ((sentiment.score + 100) / 200) * 100;

  return (
    <div className="market-section" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Sentimiento General del Mercado - BTC/USDT
      </div>
      <div style={{ fontSize: '3rem', fontWeight: 800, color: sentiment.color, lineHeight: 1, margin: '0.5rem 0' }}>
        {sentiment.score >= 0 ? '+' : ''}{sentiment.score}
      </div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: sentiment.color }}>{sentiment.overall}</div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', maxWidth: 600, margin: '0.5rem auto 0', lineHeight: 1.5 }}>
        {sentiment.action}
      </div>
      <div style={{ width: '100%', height: 8, background: 'linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e, #16a34a)', borderRadius: 4, marginTop: '1rem', position: 'relative' }}>
        <div style={{
          position: 'absolute', top: -4, width: 16, height: 16, background: 'white',
          borderRadius: '50%', border: '3px solid var(--surface)', transform: 'translateX(-50%)',
          boxShadow: '0 0 8px rgba(0,0,0,0.4)', left: `${pct}%`,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
        <span>Muy Bajista (-100)</span><span>Neutral (0)</span><span>Muy Alcista (+100)</span>
      </div>
    </div>
  );
}
