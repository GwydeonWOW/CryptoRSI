import { useState, useEffect, useCallback } from 'react';
import { useAPI } from '../hooks/useAPI';
import TokenCard from './TokenCard';
import AddTokenModal from './AddTokenModal';
import Loading from '../components/Loading';

export default function Dashboard() {
  const [tokens, setTokens] = useState([]);
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rsiData, posData] = await Promise.all([
        useAPI('/api/rsi'),
        useAPI('/api/trade/positions'),
      ]);
      setTokens(rsiData);
      const posMap = {};
      for (const p of posData) posMap[p.symbol] = p;
      setPositions(posMap);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', marginRight: 4 }}></span>Comprar (RSI ≤ 30)</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--yellow)', marginRight: 4 }}></span>Esperar</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', marginRight: 4 }}></span>Vender (RSI ≥ 70)</span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>+ Añadir Token</button>
      </div>

      {loading && tokens.length === 0 ? <Loading text="Cargando datos RSI..." /> : (
        <div className="tokens-grid">
          {tokens.map(token => (
            <TokenCard key={token.symbol} data={token} position={positions[token.symbol]} onRefresh={refresh} />
          ))}
        </div>
      )}

      <AddTokenModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={refresh}
      />
    </div>
  );
}
