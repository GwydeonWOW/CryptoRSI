/**
 * Users Store - User management with admin/user roles
 */

const path = require('path');
const fs = require('fs');
const { getDataDir, ensureDataDir, readJSON, writeJSON } = require('./storage');
const { hashPassword, verifyPassword } = require('./auth');

const USERS_PATH = path.join(getDataDir(), 'users.json');

const ADMIN_ID = 'admin_001';

function loadUsers() {
  ensureDataDir();
  return readJSON(USERS_PATH, []);
}

function saveUsers(users) {
  writeJSON(USERS_PATH, users);
}

/**
 * Create default admin user on first run
 */
async function ensureAdmin() {
  const users = loadUsers();
  if (!users.find(u => u.id === ADMIN_ID)) {
    const hashed = await hashPassword('admin123');
    users.push({
      id: ADMIN_ID,
      username: 'admin',
      password: hashed,
      displayName: 'Administrador',
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
    saveUsers(users);
    console.log('Default admin user created (admin / admin123) - change password after first login!');
  }
}

/**
 * List all users (without passwords)
 */
function listUsers() {
  return loadUsers().map(({ password, ...u }) => u);
}

/**
 * Get user by id
 */
function getUserById(id) {
  const u = loadUsers().find(u => u.id === id);
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
}

/**
 * Get full user with password (for login verification)
 */
function getUserByUsername(username) {
  return loadUsers().find(u => u.username === username) || null;
}

/**
 * Create a new user
 */
async function createUser(username, password, displayName, role = 'user') {
  const users = loadUsers();

  if (users.find(u => u.username === username)) {
    return { error: `El usuario "${username}" ya existe` };
  }
  if (!username || username.length < 2) {
    return { error: 'Username debe tener al menos 2 caracteres' };
  }
  if (!password || password.length < 4) {
    return { error: 'La contrasena debe tener al menos 4 caracteres' };
  }

  const hashed = await hashPassword(password);
  const user = {
    id: 'user_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    username,
    password: hashed,
    displayName: displayName || username,
    role: role === 'admin' ? 'admin' : 'user',
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  saveUsers(users);

  const { password: _, ...safe } = user;
  return { success: true, user: safe };
}

/**
 * Delete a user (admin only, cannot delete self)
 */
function deleteUser(id) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return { error: 'Usuario no encontrado' };
  if (id === ADMIN_ID) return { error: 'No se puede eliminar el usuario admin principal' };

  const deleted = users.splice(idx, 1)[0];
  saveUsers(users);

  // Remove user's trades file
  const tradesFile = path.join(getDataDir(), `trades_${id}.json`);
  if (fs.existsSync(tradesFile)) {
    fs.unlinkSync(tradesFile);
  }

  const { password: _, ...safe } = deleted;
  return { success: true, user: safe };
}

/**
 * Update user profile (own data)
 */
async function updateUser(id, updates) {
  const users = loadUsers();
  const user = users.find(u => u.id === id);
  if (!user) return { error: 'Usuario no encontrado' };

  if (updates.displayName) {
    user.displayName = updates.displayName;
  }
  if (updates.password) {
    if (updates.password.length < 4) {
      return { error: 'La contrasena debe tener al menos 4 caracteres' };
    }
    user.password = await hashPassword(updates.password);
  }

  saveUsers(users);

  const { password: _, ...safe } = user;
  return { success: true, user: safe };
}

module.exports = {
  ensureAdmin,
  listUsers,
  getUserById,
  getUserByUsername,
  createUser,
  deleteUser,
  updateUser,
};
