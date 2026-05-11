import { useState, useEffect, useCallback } from 'react';
import { useAPI } from '../hooks/useAPI';
import { isModerator } from '../hooks/useRoles';
import TokenCard from './TokenCard';
import AddTokenModal from './AddTokenModal';
import Loading from '../components/Loading';

export default function Dashboard({ refreshTrigger, user }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rsiData = await useAPI('/api/rsi');
      setTokens(rsiData);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (refreshTrigger > 0) refresh(); }, [refreshTrigger]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', marginRight: 4 }}></span>Comprar (RSI ≤ 30)</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--yellow)', marginRight: 4 }}></span>Esperar</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', marginRight: 4 }}></span>Vender (RSI ≥ 70)</span>
        </div>
        {isModerator(user) && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>+ Anadir Token</button>
        )}
      </div>

      {loading && tokens.length === 0 ? <Loading text="Cargando datos RSI..." /> : (
        <div className="tokens-grid">
          {tokens.map(token => (
            <TokenCard key={token.symbol} data={token} onRefresh={refresh} isAdmin={isModerator(user)} />
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
