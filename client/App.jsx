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

  const refresh = useCallback(() => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent('app-refresh'));
    setTimeout(() => setRefreshing(false), 2000);
  }, []);

  return (
    <>
      <Header onRefresh={refresh} refreshing={refreshing} />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 2rem' }}>
        <RefreshBar onRefresh={refresh} />
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
        <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
          <Dashboard />
        </div>
        <div style={{ display: activeTab === 'market' ? 'block' : 'none' }}>
          <MarketAnalysis />
        </div>
        <div style={{ display: activeTab === 'historicos' ? 'block' : 'none' }}>
          <Historicos />
        </div>
        <div style={{ display: activeTab === 'history' ? 'block' : 'none' }}>
          <TradeHistory />
        </div>
      </div>
    </>
  );
}
