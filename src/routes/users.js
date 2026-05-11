/**
 * User Management Routes — admin-only
 */

const { Router } = require('express');
const { authMiddleware, adminMiddleware, ownerMiddleware } = require('../auth');
const { listUsers, createUser, deleteUser, changeUserRole } = require('../users');
const { validateCreateUser, handleValidationErrors } = require('../middleware/validate');

const router = Router();

router.get('/users', authMiddleware, adminMiddleware, (req, res) => {
  res.json(listUsers());
});

router.post('/users', authMiddleware, adminMiddleware, validateCreateUser, handleValidationErrors, async (req, res) => {
  const { username, password, displayName, role } = req.body;
  const result = await createUser(username, password, displayName, role);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.delete('/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }
  const result = deleteUser(req.params.id);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.patch('/users/:id/role', authMiddleware, ownerMiddleware, (req, res) => {
  const { role } = req.body;
  const result = changeUserRole(req.params.id, role, req.user.role);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
