import { useState, useCallback, useRef, useEffect } from 'react';
import Header from './components/Header';
import TabNav from './components/TabNav';
import RefreshBar from './components/RefreshBar';
import Dashboard from './dashboard/Dashboard';
import MarketAnalysis from './market/MarketAnalysis';
import Settings from './settings/Settings';
import TradeHistory from './trades/TradeHistory';
import BacktestPage from './backtest/BacktestPage';
import UserPanel from './auth/UserPanel';
import ProfileModal from './auth/ProfileModal';
import Login from './auth/Login';
import { ToastProvider } from './hooks/useToast';
import { TimezoneProvider } from './hooks/useTimezone';
import { isAdmin as checkIsAdmin } from './hooks/useRoles';

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
    dashboard: 0, market: 0, trades: 0, users: 0,
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
    setTriggers({ dashboard: 0, market: 0, trades: 0, users: 0 });
    visitedRef.current = {};
  }, []);

  if (!authReady) return null;

  if (!user) return <Login onLogin={setUser} />;

  const isAdmin = checkIsAdmin(user);

  return (
    <TimezoneProvider>
    <ToastProvider>
      <Header onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated} user={user} onLogout={handleLogout} onProfile={() => setShowProfile(true)} />
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '1.5rem 2rem' }}>
        <RefreshBar onRefresh={refresh} user={user} />
        <TabNav activeTab={activeTab} onTabChange={handleTabChange} isAdmin={isAdmin} />
        <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
          <Dashboard refreshTrigger={triggers.dashboard} user={user} />
        </div>
        <div style={{ display: activeTab === 'market' ? 'block' : 'none' }}>
          <MarketAnalysis refreshTrigger={triggers.market} />
        </div>
        <div style={{ display: activeTab === 'trades' ? 'block' : 'none' }}>
          <TradeHistory refreshTrigger={triggers.trades} user={user} />
        </div>
        {isAdmin && (
          <div style={{ display: activeTab === 'backtest' ? 'block' : 'none' }}>
            <BacktestPage />
          </div>
        )}
        {isAdmin && (
          <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
            <Settings />
          </div>
        )}
        {isAdmin && (
          <div style={{ display: activeTab === 'users' ? 'block' : 'none' }}>
            <UserPanel user={user} />
          </div>
        )}
      </div>
      {showProfile && (
        <ProfileModal user={user} onClose={() => setShowProfile(false)} onUpdated={setUser} />
      )}
    </ToastProvider>
    </TimezoneProvider>
  );
}
