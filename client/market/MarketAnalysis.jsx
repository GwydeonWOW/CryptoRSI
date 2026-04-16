import { useState, useEffect } from 'react';
import Loading from '../components/Loading';
import SentimentCard from './SentimentCard';
import SignalCards from './SignalCards';
import LiqHeatmap from './LiqHeatmap';
import FundingChart from './FundingChart';
import LongShortChart from './LongShortChart';
import OpenInterestChart from './OpenInterestChart';
import TakerVolumeChart from './TakerVolumeChart';

export default function MarketAnalysis({ refreshTrigger }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch('/api/market/BTC', { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const result = await res.json();
      if (result.error) throw new Error(result.error);

      setData(result);
    } catch (e) {
      if (e.name === 'AbortError') {
        setError('La peticion tardo demasiado (30s). Intentalo de nuevo.');
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (refreshTrigger > 0) load(); }, [refreshTrigger]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
      <div style={{
        display: 'inline-block', width: '2rem', height: '2rem',
        border: '3px solid var(--surface2)', borderTopColor: 'var(--blue)',
        borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '1rem'
      }} />
      <p>Cargando analisis de mercado...</p>
      <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
        Obteniendo datos de Binance Futures (funding rate, open interest, long/short ratio...)
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );

  if (error) return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--red)' }}>Error al cargar datos de mercado</p>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '1rem' }}>{error}</p>
      <button className="btn btn-primary" onClick={load}>Reintentar</button>
    </div>
  );

  if (!data) return (
    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
      <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Sin datos de mercado</p>
      <p style={{ fontSize: '0.75rem' }}>Pulsa "Actualizar" para cargar los datos de Binance Futures.</p>
    </div>
  );

  return (
    <div>
      <SentimentCard sentiment={data.sentiment} price={data.currentPrice} />
      <div className="market-section">
        <h3 className="section-title">Mapa de Zonas de Liquidacion</h3>
        <p className="section-desc">Zonas de precio donde se concentran liquidaciones de posiciones apalancadas.</p>
        <LiqHeatmap zones={data.liquidationZones} currentPrice={data.currentPrice} />
      </div>
      <SignalCards signals={data.sentiment?.signals} />
      <div className="market-charts-grid">
        <div className="market-section">
          <h3 className="section-title">Funding Rate</h3>
          <p className="section-desc">Coste de mantener posiciones en futuros. Positivo = longs pagan shorts.</p>
          <FundingChart data={data.fundingRate} />
        </div>
        <div className="market-section">
          <h3 className="section-title">Long/Short Ratio</h3>
          <p className="section-desc">Proporcion de traders en long vs short.</p>
          <LongShortChart data={data.longShortRatio} topData={data.topTraderRatio} />
        </div>
        <div className="market-section">
          <h3 className="section-title">Open Interest</h3>
          <p className="section-desc">Total de contratos de futuros abiertos.</p>
          <OpenInterestChart data={data.oiHistory} />
        </div>
        <div className="market-section">
          <h3 className="section-title">Taker Buy/Sell</h3>
          <p className="section-desc">Flujo de ordenes agresivas. Mayor a 1 = mas compras.</p>
          <TakerVolumeChart data={data.takerVolume} />
        </div>
      </div>
    </div>
  );
}
