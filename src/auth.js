/**
 * Authentication Module - JWT + bcrypt
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Secret key - MUST be set via env var or settings UI
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('WARNING: JWT_SECRET not set. Using insecure default. Set it in .env or Settings UI.');
  return 'cryptorsi_insecure_default_change_me';
})();
const JWT_EXPIRES = '7d';

// ============================================================
// Password utilities
// ============================================================

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ============================================================
// JWT utilities
// ============================================================

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ============================================================
// Express middlewares
// ============================================================

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Token invalido o expirado' });
  }

  req.user = payload;
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido al administrador' });
  }
  next();
}

function moderatorMiddleware(req, res, next) {
  if (!req.user || !['admin', 'moderator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Acceso restringido' });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authMiddleware,
  adminMiddleware,
  moderatorMiddleware,
};
