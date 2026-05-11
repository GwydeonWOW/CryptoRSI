/**
 * Users Store — SQLite-based user management with admin/moderator/user roles
 */

const { getDb } = require('./db');
const { hashPassword, verifyPassword } = require('./auth');

const ADMIN_ID = 'admin_001';

async function ensureAdmin() {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(ADMIN_ID);
  if (!existing) {
    const hashed = await hashPassword('admin123');
    db.prepare('INSERT OR IGNORE INTO users (id, username, password, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ADMIN_ID, 'admin', hashed, 'Administrador', 'admin', new Date().toISOString());
    console.log('Default admin user created (admin / admin123) - change password after first login!');
  }
}

function listUsers() {
  const db = getDb();
  return db.prepare('SELECT id, username, display_name, role, created_at FROM users').all();
}

function getUserById(id) {
  const db = getDb();
  return db.prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?').get(id) || null;
}

function getUserByUsername(username) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}

async function createUser(username, password, displayName, role = 'user') {
  if (!username || username.length < 2) {
    return { error: 'Username debe tener al menos 2 caracteres' };
  }
  if (!password || password.length < 4) {
    return { error: 'La contrasena debe tener al menos 4 caracteres' };
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return { error: `El usuario "${username}" ya existe` };
  }

  const hashed = await hashPassword(password);
  const validRoles = ['admin', 'moderator', 'user'];
  const id = 'user_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  db.prepare('INSERT INTO users (id, username, password, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, username, hashed, displayName || username, validRoles.includes(role) ? role : 'user', new Date().toISOString());

  return { success: true, user: { id, username, displayName: displayName || username, role: validRoles.includes(role) ? role : 'user' } };
}

function deleteUser(id) {
  const db = getDb();
  if (id === ADMIN_ID) return { error: 'No se puede eliminar el usuario admin principal' };

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return { error: 'Usuario no encontrado' };

  db.transaction(() => {
    db.prepare('DELETE FROM positions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM history WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  })();

  return { success: true, user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } };
}

async function updateUser(id, updates) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return { error: 'Usuario no encontrado' };

  if (updates.displayName) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(updates.displayName, id);
  }
  if (updates.password) {
    if (updates.password.length < 4) {
      return { error: 'La contrasena debe tener al menos 4 caracteres' };
    }
    const hashed = await hashPassword(updates.password);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, id);
  }

  const updated = db.prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?').get(id);
  return { success: true, user: updated };
}

module.exports = { ensureAdmin, listUsers, getUserById, getUserByUsername, createUser, deleteUser, updateUser };
