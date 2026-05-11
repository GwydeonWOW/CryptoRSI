import { useState, useEffect } from 'react';
import { useToast } from '../hooks/useToast';
import { isOwner, roleLabel } from '../hooks/useRoles';

const ROLE_COLORS = {
  owner: { bg: 'rgba(234,179,8,0.15)', color: 'var(--gold, #eab308)' },
  admin: { bg: 'rgba(59,130,246,0.15)', color: 'var(--blue)' },
  moderator: { bg: 'rgba(139,92,246,0.15)', color: '#8b5cf6' },
  user: { bg: 'rgba(148,163,184,0.1)', color: 'var(--text-dim)' },
};

export default function UserPanel({ user: currentUser }) {
  const [users, setUsers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'user' });
  const [msg, setMsg] = useState(null);
  const [rateLimits, setRateLimits] = useState([]);
  const { addToast } = useToast();

  const isOwner = currentUser?.role === 'owner';

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    };
  }

  async function loadUsers() {
    try {
      const res = await fetch('/api/users', { headers: authHeaders() });
      if (!res.ok) throw new Error('Error cargando usuarios');
      setUsers(await res.json());
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ type: 'error', text: data.error }); return; }
      setMsg({ type: 'ok', text: `Usuario "${data.user.username}" creado` });
      setForm({ username: '', password: '', displayName: '', role: 'user' });
      setShowCreate(false);
      loadUsers();
    } catch (e) {
      setMsg({ type: 'error', text: 'Error de conexion' });
    }
  }

  async function handleDelete(id, username) {
    if (!confirm(`Eliminar usuario "${username}"? Sus trades se perderan.`)) return;
    setMsg(null);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ type: 'error', text: data.error }); return; }
      setMsg({ type: 'ok', text: `Usuario "${username}" eliminado` });
      loadUsers();
    } catch (e) {
      setMsg({ type: 'error', text: 'Error de conexion' });
    }
  }

  async function handleRoleChange(userId, newRole) {
    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) { addToast('error', data.error); return; }
      addToast('success', `Rol cambiado a ${roleLabel(newRole)}`);
      loadUsers();
    } catch (e) {
      addToast('error', e.message);
    }
  }

  async function loadRateLimits() {
    try {
      const res = await fetch('/api/admin/rate-limits', { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setRateLimits(data.rateLimits || []);
    } catch {}
  }

  async function clearRateLimit(key) {
    try {
      const res = await fetch(`/api/admin/rate-limits/${encodeURIComponent(key)}`, {
        method: 'DELETE', headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) { addToast('error', data.error); return; }
      addToast('success', data.message);
      loadRateLimits();
    } catch (e) { addToast('error', e.message); }
  }

  async function clearAllRateLimits() {
    try {
      const res = await fetch('/api/admin/rate-limits', {
        method: 'DELETE', headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) { addToast('error', data.error); return; }
      addToast('success', `${data.cleared} IPs desbloqueadas`);
      loadRateLimits();
    } catch (e) { addToast('error', e.message); }
  }

  useEffect(() => { if (isOwner) loadRateLimits(); }, [isOwner]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 className="section-title">Gestion de Usuarios</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancelar' : '+ Nuevo Usuario'}
        </button>
      </div>

      {msg && (
        <div style={{
          padding: '0.5rem 1rem', marginBottom: '1rem', borderRadius: 8, fontSize: '0.85rem',
          background: msg.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
          border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
          color: msg.type === 'error' ? 'var(--red)' : 'var(--green)',
        }}>
          {msg.text}
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} style={{
          background: 'var(--surface)', border: '1px solid var(--surface2)',
          borderRadius: 10, padding: '1.5rem', marginBottom: '1.5rem',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem',
        }}>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Username *</label>
            <input required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
              style={{ width: '100%', padding: '0.4rem 0.6rem', marginTop: 2, background: 'var(--bg)', border: '1px solid var(--surface2)', borderRadius: 6, color: 'var(--text)' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Contrasena *</label>
            <input type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
              style={{ width: '100%', padding: '0.4rem 0.6rem', marginTop: 2, background: 'var(--bg)', border: '1px solid var(--surface2)', borderRadius: 6, color: 'var(--text)' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Nombre visible</label>
            <input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })}
              style={{ width: '100%', padding: '0.4rem 0.6rem', marginTop: 2, background: 'var(--bg)', border: '1px solid var(--surface2)', borderRadius: 6, color: 'var(--text)' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Rol</label>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
              style={{ width: '100%', padding: '0.4rem 0.6rem', marginTop: 2, background: 'var(--bg)', border: '1px solid var(--surface2)', borderRadius: 6, color: 'var(--text)' }}>
              <option value="user">Usuario</option>
              <option value="moderator">Moderador</option>
              <option value="admin">Admin</option>
              {isOwner && <option value="owner">Owner</option>}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1', textAlign: 'right' }}>
            <button type="submit" className="btn btn-primary btn-sm">Crear Usuario</button>
          </div>
        </form>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--surface2)' }}>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Usuario</th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Nombre</th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Rol</th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Creado</th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 500 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const rc = ROLE_COLORS[u.role] || ROLE_COLORS.user;
              return (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--surface2)' }}>
                  <td style={{ padding: '0.6rem 1rem', fontWeight: 600 }}>{u.username}</td>
                  <td style={{ padding: '0.6rem 1rem' }}>{u.displayName}</td>
                  <td style={{ padding: '0.6rem 1rem' }}>
                    {isOwner && u.id !== currentUser?.id ? (
                      <select value={u.role}
                        onChange={e => handleRoleChange(u.id, e.target.value)}
                        style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                          background: rc.bg, color: rc.color,
                          border: `1px solid ${rc.color}40`, cursor: 'pointer',
                        }}>
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="moderator">Moderador</option>
                        <option value="user">Usuario</option>
                      </select>
                    ) : (
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                        background: rc.bg, color: rc.color,
                      }}>
                        {roleLabel(u.role)}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.6rem 1rem', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                    {new Date(u.createdAt).toLocaleDateString('es-ES')}
                  </td>
                  <td style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                    {u.id !== currentUser?.id && (
                      <button className="btn btn-sm" style={{ color: 'var(--red)', background: 'rgba(239,68,68,0.1)' }}
                        onClick={() => handleDelete(u.id, u.username)}>
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Rate Limits — Owner only */}
      {isOwner && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 className="section-title" style={{ marginBottom: 0 }}>IPs Bloqueadas (Rate Limit)</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-secondary btn-sm" onClick={loadRateLimits}>Actualizar</button>
              {rateLimits.length > 0 && (
                <button className="btn btn-sm" onClick={clearAllRateLimits}
                  style={{ color: 'var(--red)', background: 'rgba(239,68,68,0.1)' }}>
                  Desbloquear todas
                </button>
              )}
            </div>
          </div>
          {rateLimits.length === 0 ? (
            <div style={{ padding: '1rem', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--surface2)', color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center' }}>
              No hay IPs bloqueadas
            </div>
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface2)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surface2)' }}>
                    <th style={{ padding: '0.5rem 1rem', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>IP / Key</th>
                    <th style={{ padding: '0.5rem 1rem', textAlign: 'center', color: 'var(--text-dim)', fontWeight: 500 }}>Intentos</th>
                    <th style={{ padding: '0.5rem 1rem', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500 }}>Resetea</th>
                    <th style={{ padding: '0.5rem 1rem', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 500 }}>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {rateLimits.map(entry => {
                    const ip = entry.key.includes(':') ? entry.key.split(':').slice(1).join(':') : entry.key;
                    return (
                      <tr key={entry.key} style={{ borderBottom: '1px solid var(--surface2)' }}>
                        <td style={{ padding: '0.5rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{ip}</td>
                        <td style={{ padding: '0.5rem 1rem', textAlign: 'center', fontWeight: 600, color: 'var(--red)' }}>{entry.hits}</td>
                        <td style={{ padding: '0.5rem 1rem', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                          {entry.resetTime ? new Date(entry.resetTime).toLocaleTimeString('es-ES') : '-'}
                        </td>
                        <td style={{ padding: '0.5rem 1rem', textAlign: 'right' }}>
                          <button className="btn btn-sm" onClick={() => clearRateLimit(entry.key)}
                            style={{ color: 'var(--green)', background: 'rgba(34,197,94,0.1)' }}>
                            Desbloquear
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
