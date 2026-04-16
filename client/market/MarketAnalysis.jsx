import { useState, useEffect } from 'react';
import { useAPI } from '../hooks/useAPI';
import Loading from '../components/Loading';
import SentimentCard from './SentimentCard';
import SignalCards from './SignalCards';
import LiqHeatmap from './LiqHeatmap';
import FundingChart from './FundingChart';
import LongShortChart from './LongShortChart';
import OpenInterestChart from './OpenInterestChart';
import TakerVolumeChart from './TakerVolumeChart';

export default function MarketAnalysis() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await useAPI('/api/market/BTC');
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <Loading text="Cargando analisis de mercado..." />;

  if (error) return (
    <div className="token-error" style={{ padding: '2rem', textAlign: 'center' }}>
      <p style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Error al cargar datos de mercado</p>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{error}</p>
      <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={load}>Reintentar</button>
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
