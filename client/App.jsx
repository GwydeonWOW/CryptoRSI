import { useState, useCallback } from 'react';
import Header from './components/Header';
import TabNav from './components/TabNav';
import RefreshBar from './components/RefreshBar';
import Dashboard from './dashboard/Dashboard';
import MarketAnalysis from './market/MarketAnalysis';
import TradeHistory from './history/TradeHistory';
import Historicos from './historicos/Historicos';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [refreshing, setRefreshing] = useState(false);
  // Per-tab refresh triggers: dashboard starts at 1 for initial load, others at 0 (no fetch)
  const [triggers, setTriggers] = useState({
    dashboard: 1,
    market: 0,
    historicos: 0,
    history: 0,
  });

  const refresh = useCallback(() => {
    setRefreshing(true);
    // Only refresh the currently active tab
    setTriggers(prev => ({ ...prev, [activeTab]: prev[activeTab] + 1 }));
    setTimeout(() => setRefreshing(false), 2000);
  }, [activeTab]);

  return (
    <>
      <Header onRefresh={refresh} refreshing={refreshing} />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 2rem' }}>
        <RefreshBar onRefresh={refresh} />
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
        <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
          <Dashboard refreshTrigger={triggers.dashboard} />
        </div>
        <div style={{ display: activeTab === 'market' ? 'block' : 'none' }}>
          <MarketAnalysis refreshTrigger={triggers.market} />
        </div>
        <div style={{ display: activeTab === 'historicos' ? 'block' : 'none' }}>
          <Historicos refreshTrigger={triggers.historicos} />
        </div>
        <div style={{ display: activeTab === 'history' ? 'block' : 'none' }}>
          <TradeHistory refreshTrigger={triggers.history} />
        </div>
      </div>
    </>
  );
}
