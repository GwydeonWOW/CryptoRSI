import { useState, useCallback, useRef, useEffect } from 'react';
import Header from './components/Header';
import TabNav from './components/TabNav';
import RefreshBar from './components/RefreshBar';
import Dashboard from './dashboard/Dashboard';
import MarketAnalysis from './market/MarketAnalysis';
import TradeHistory from './history/TradeHistory';
import Historicos from './historicos/Historicos';
import UserPanel from './auth/UserPanel';
import ProfileModal from './auth/ProfileModal';
import Login from './auth/Login';

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // Restore session from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (saved && token) {
      try { setUser(JSON.parse(saved)); } catch { localStorage.clear(); }
    }
    setAuthReady(true);
  }, []);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [triggers, setTriggers] = useState({
    dashboard: 0, market: 0, historicos: 0, history: 0, users: 0,
  });
  const visitedRef = useRef({});

  // Trigger initial load after login
  useEffect(() => {
    if (user && !visitedRef.current.dashboard) {
      visitedRef.current.dashboard = true;
      setTriggers(prev => ({ ...prev, dashboard: 1 }));
    }
  }, [user]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setLastUpdated(new Date());
    setTriggers(prev => ({ ...prev, [activeTab]: prev[activeTab] + 1 }));
    setTimeout(() => setRefreshing(false), 2000);
  }, [activeTab]);

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    if (!visitedRef.current[tab]) {
      visitedRef.current[tab] = true;
      setTriggers(prev => ({ ...prev, [tab]: prev[tab] + 1 }));
    }
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setTriggers({ dashboard: 0, market: 0, historicos: 0, history: 0, users: 0 });
    visitedRef.current = {};
  }, []);

  if (!authReady) return null;

  if (!user) return <Login onLogin={setUser} />;

  const isAdmin = user.role === 'admin';

  return (
    <>
      <Header onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated} user={user} onLogout={handleLogout} onProfile={() => setShowProfile(true)} />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 2rem' }}>
        <RefreshBar onRefresh={refresh} />
        <TabNav activeTab={activeTab} onTabChange={handleTabChange} isAdmin={isAdmin} />
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
        {isAdmin && (
          <div style={{ display: activeTab === 'users' ? 'block' : 'none' }}>
            <UserPanel />
          </div>
        )}
      </div>
      {showProfile && (
        <ProfileModal user={user} onClose={() => setShowProfile(false)} onUpdated={setUser} />
      )}
    </>
  );
}
