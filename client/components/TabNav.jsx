export default function TabNav({ activeTab, onTabChange, isAdmin }) {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'market', label: 'Analisis de Mercado' },
    ...(isAdmin ? [{ id: 'settings', label: 'Configuracion' }] : []),
    ...(isAdmin ? [{ id: 'users', label: 'Usuarios' }] : []),
  ];

  return (
    <div className="main-tabs">
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
  );
}
