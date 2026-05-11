import { useState } from 'react';

export default function TabNav({ activeTab, onTabChange, isAdmin }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'market', label: 'Analisis de Mercado' },
    { id: 'trades', label: 'Simulador' },
    ...(isAdmin ? [{ id: 'backtest', label: 'Backtest' }] : []),
    ...(isAdmin ? [{ id: 'settings', label: 'Configuracion' }] : []),
    ...(isAdmin ? [{ id: 'users', label: 'Usuarios' }] : []),
  ];

  function selectTab(id) {
    onTabChange(id);
    setMenuOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Hamburger button — hidden on desktop via CSS */}
      <button className="tabnav-hamburger" onClick={() => setMenuOpen(!menuOpen)}
        style={{
          display: 'none',
          background: 'var(--surface)',
          border: 'none',
          padding: '0.6rem 1rem',
          color: 'var(--text)',
          fontSize: '1.2rem',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          borderBottom: '1px solid var(--surface2)',
        }}>
        <span style={{ marginRight: 8 }}>&#9776;</span>
        {tabs.find(t => t.id === activeTab)?.label || 'Menu'}
      </button>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="tabnav-dropdown" style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: 'var(--surface)', borderBottom: '1px solid var(--surface2)',
          zIndex: 50,
        }}>
          {tabs.map(tab => (
            <button key={tab.id}
              onClick={() => selectTab(tab.id)}
              style={{
                display: 'block', width: '100%', padding: '0.7rem 1.2rem',
                border: 'none', background: activeTab === tab.id ? 'rgba(59,130,246,0.1)' : 'transparent',
                color: activeTab === tab.id ? 'var(--blue)' : 'var(--text)',
                textAlign: 'left', cursor: 'pointer', fontSize: '0.9rem',
                fontWeight: activeTab === tab.id ? 600 : 400,
              }}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Desktop tab bar */}
      <div className="main-tabs tabnav-desktop">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`main-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
