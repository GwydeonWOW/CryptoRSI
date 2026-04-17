import { useState } from 'react';
import { getAuthHeaders } from '../hooks/useAPI';

export default function ProfileModal({ user, onClose, onUpdated }) {
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg(null);

    if (password && password !== confirmPwd) {
      setMsg({ type: 'error', text: 'Las contrasenas no coinciden' });
      return;
    }
    if (password && password.length < 4) {
      setMsg({ type: 'error', text: 'La contrasena debe tener al menos 4 caracteres' });
      return;
    }

    setLoading(true);
    try {
      const body = {};
      if (displayName && displayName !== user.displayName) body.displayName = displayName;
      if (password) body.password = password;

      if (Object.keys(body).length === 0) {
        setMsg({ type: 'error', text: 'No hay cambios' });
        setLoading(false);
        return;
      }

      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ type: 'error', text: data.error }); return; }

      // Update localStorage
      const saved = JSON.parse(localStorage.getItem('user') || '{}');
      const updated = { ...saved, ...data.user };
      localStorage.setItem('user', JSON.stringify(updated));
      onUpdated(updated);
      setMsg({ type: 'ok', text: 'Perfil actualizado correctamente' });
      setPassword('');
      setConfirmPwd('');
    } catch (e) {
      setMsg({ type: 'error', text: 'Error de conexion' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay active" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 style={{ marginBottom: '1.5rem' }}>Mi Perfil</h2>

        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: 'var(--bg)', borderRadius: 8, fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-dim)' }}>Usuario</span>
            <strong>{user.username}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ color: 'var(--text-dim)' }}>Rol</span>
            <span>{user.role === 'admin' ? 'Admin' : 'Usuario'}</span>
          </div>
        </div>

        {msg && (
          <div style={{
            padding: '0.5rem 0.8rem', marginBottom: '1rem', borderRadius: 6, fontSize: '0.85rem',
            background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
            border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
            color: msg.type === 'error' ? 'var(--red)' : 'var(--green)',
          }}>
            {msg.text}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Nombre visible</label>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder={user.username} />
          </div>
          <div className="form-group">
            <label>Nueva contrasena</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Dejar vacio para no cambiar" />
          </div>
          {password && (
            <div className="form-group">
              <label>Confirmar contrasena</label>
              <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                placeholder="Repetir contrasena" />
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
