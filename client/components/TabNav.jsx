export default function TabNav({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'market', label: 'Analisis de Mercado' },
    { id: 'historicos', label: 'Historicos' },
    { id: 'history', label: 'Historial Trades' },
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
