export default function Header({ onRefresh, refreshing, lastUpdated, user, onLogout }) {
  return (
    <header style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--surface2)',
      padding: '1rem 2rem',
    }}>
      <div style={{
        maxWidth: 1100,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--blue)' }}>
          CryptoRSI <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: '0.9rem' }}>Seguimiento RSI Personal</span>
        </h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {lastUpdated && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Ultima actualizacion: {lastUpdated.toLocaleString('es-ES')}
            </span>
          )}
          <button className="btn btn-secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Actualizando...' : 'Actualizar'}
          </button>
          {user && (
            <>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', padding: '0 0.3rem' }}>
                {user.displayName || user.username}
                {user.role === 'admin' && <span style={{ color: 'var(--blue)', marginLeft: 4, fontSize: '0.7rem' }}>Admin</span>}
              </span>
              <button className="btn btn-sm" onClick={onLogout}
                style={{ color: 'var(--text-dim)', background: 'rgba(148,163,184,0.1)' }}>
                Salir
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
