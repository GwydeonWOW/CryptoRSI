import { useState, useCallback, useRef } from 'react';
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
  const dashboardRef = useRef(null);

  const refresh = useCallback(async () => {
    // Trigger a page reload for simplicity - components manage their own state
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent('app-refresh'));
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  return (
    <>
      <Header onRefresh={refresh} refreshing={refreshing} />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 2rem' }}>
        <RefreshBar onRefresh={refresh} />
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'market' && <MarketAnalysis />}
        {activeTab === 'historicos' && <Historicos />}
        {activeTab === 'history' && <TradeHistory />}
      </div>
    </>
  );
}
