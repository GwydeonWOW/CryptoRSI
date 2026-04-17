import { useState } from 'react';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Error al iniciar sesion');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onLogin(data.user);
    } catch (e) {
      setError('Error de conexion');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: '1rem',
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--surface2)',
        borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 380,
      }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--blue)', marginBottom: 4 }}>
            CryptoRSI
          </h1>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Inicia sesion para continuar</p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '0.6rem 1rem', marginBottom: '1rem',
            color: 'var(--red)', fontSize: '0.85rem', textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 4 }}>
              Usuario
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
              style={{
                width: '100%', padding: '0.6rem 0.8rem', fontSize: '0.9rem',
                background: 'var(--bg)', border: '1px solid var(--surface2)',
                borderRadius: 8, color: 'var(--text)', outline: 'none',
              }}
            />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 4 }}>
              Contrasena
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{
                width: '100%', padding: '0.6rem 0.8rem', fontSize: '0.9rem',
                background: 'var(--bg)', border: '1px solid var(--surface2)',
                borderRadius: 8, color: 'var(--text)', outline: 'none',
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.7rem', fontSize: '1rem' }}
          >
            {loading ? 'Iniciando...' : 'Iniciar Sesion'}
          </button>
        </form>
      </div>
    </div>
  );
}
