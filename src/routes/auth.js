/**
 * Auth Routes — Login, profile, session management
 */

const { Router } = require('express');
const { authMiddleware, generateToken, verifyPassword } = require('../auth');
const { getUserByUsername, updateUser } = require('../users');
const { authLimiter } = require('../middleware/rateLimit');
const { validateLogin, handleValidationErrors } = require('../middleware/validate');

const router = Router();

router.post('/auth/login', authLimiter, validateLogin, handleValidationErrors, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username y contrasena requeridos' });
  }

  const user = getUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
  }

  const token = generateToken(user);
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

router.get('/auth/me', authMiddleware, (req, res) => {
  const user = getUserByUsername(req.user.username);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { password: _, ...safeUser } = user;
  res.json(safeUser);
});

router.put('/auth/me', authMiddleware, async (req, res) => {
  const result = await updateUser(req.user.id, req.body);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
