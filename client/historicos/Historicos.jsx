import { useState, useEffect, useCallback } from 'react';
import { useAPI } from '../hooks/useAPI';
import Loading from '../components/Loading';

export default function Historicos({ refreshTrigger }) {
  const [tokens, setTokens] = useState([]);
  const [symbol, setSymbol] = useState('');
  const [days, setDays] = useState(30);
  const [rsiHist, setRsiHist] = useState([]);
  const [priceHist, setPriceHist] = useState([]);
  const [sentimentHist, setSentimentHist] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (sym, d) => {
    if (!sym) return;
    setLoading(true);
    try {
      const [r, p, m] = await Promise.all([
        useAPI(`/api/history/rsi/${sym}?days=${d}`),
        useAPI(`/api/history/prices/${sym}?days=${d}`),
        useAPI(`/api/history/market?days=${d}`),
      ]);
      setRsiHist(r);
      setPriceHist(p);
      setSentimentHist(m);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  // Load tokens list on first trigger
  useEffect(() => {
    if (refreshTrigger <= 0) return;
    useAPI('/api/tokens').then(t => {
      setTokens(t);
      if (t.length > 0) setSymbol(prev => prev || t[0].symbol);
    }).catch(() => {});
  }, [refreshTrigger]);

  // Auto-load data when symbol or days changes
  useEffect(() => {
    if (symbol) loadData(symbol, days);
  }, [symbol, days, loadData]);

  return (
    <div>
      <div className="market-section">
        <h3 className="section-title">Historico RSI - Seleccionar Token</h3>
        <p className="section-desc">Datos historicos de RSI recogidos automaticamente cada 15 minutos.</p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <select value={symbol} onChange={e => setSymbol(e.target.value)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
            {tokens.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
          <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
            {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} dias</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => loadData(symbol, days)}>Cargar</button>
        </div>
        {loading ? <Loading text="Cargando..." /> : <LineChart data={rsiHist} valueFn={d => d.rsi1d} colorFn={v => v >= 70 ? '#ef4444' : v <= 30 ? '#22c55e' : 'var(--blue)'} refs={[{ value: 70, label: '70' }, { value: 50, label: '50' }, { value: 30, label: '30' }]} />}
      </div>

      <div className="market-section">
        <h3 className="section-title">Historico de Precios</h3>
        {loading ? null : <LineChart data={priceHist} valueFn={d => d.price} colorFn={() => 'var(--blue)'} />}
      </div>

      <div className="market-section">
        <h3 className="section-title">Historico Sentimiento de Mercado (BTC)</h3>
        <p className="section-desc">Evolucion del sentimiento general basado en datos de futuros.</p>
        {loading ? null : <LineChart data={sentimentHist} valueFn={d => d.sentiment?.score} colorFn={v => v >= 20 ? '#22c55e' : v <= -20 ? '#ef4444' : '#eab308'} refs={[{ value: 50, label: '+50' }, { value: 0, label: '0' }, { value: -50, label: '-50' }]} />}
      </div>
    </div>
  );
}

function LineChart({ data, valueFn, colorFn, refs }) {
  if (!data || data.length === 0) return <div className="history-empty">Sin datos historicos aun.</div>;

  const values = data.map(valueFn).filter(v => v !== null && v !== undefined);
  if (values.length === 0) return <div className="history-empty">Sin datos validos</div>;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const refLines = (refs || []).map(ref => {
    const pct = ((ref.value - min) / range) * 100;
    if (pct < 0 || pct > 100) return null;
    return (
      <div key={ref.label}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 1, borderTop: '1px dashed rgba(100,116,139,0.3)', bottom: `${pct}%` }} />
        <div style={{ position: 'absolute', right: 0, fontSize: '0.6rem', color: 'var(--text-dim)', transform: 'translateY(-50%)', bottom: `${pct}%` }}>{ref.label}</div>
      </div>
    );
  });

  return (
    <div style={{ minHeight: 160 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', height: 140, gap: 1, position: 'relative', borderBottom: '1px solid var(--surface2)', borderLeft: '1px solid var(--surface2)' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>{refLines}</div>
        {data.map((d, i) => {
          const val = valueFn(d);
          if (val === null || val === undefined) return <div key={i} style={{ flex: 1, minWidth: 1, height: 0 }} />;
          const pct = ((val - min) / range) * 100;
          const c = colorFn ? colorFn(val) : 'var(--blue)';
          const dateLabel = d.date || d.timestamp?.split('T')[0] || '';
          return <div key={i} style={{ flex: 1, minWidth: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
            <div style={{ width: 2, height: `${pct}%`, background: c, borderRadius: 1, minHeight: 1 }} title={`${dateLabel}: ${val.toFixed(2)}`} />
          </div>;
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-dim)', marginTop: 4, padding: '0 2px' }}>
        <span>{data[0]?.date || ''}</span>
        <span>{data[data.length - 1]?.date || ''}</span>
      </div>
    </div>
  );
}
