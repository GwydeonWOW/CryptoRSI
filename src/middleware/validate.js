/**
 * Input Validation Rules
 */

const { body, param, query } = require('express-validator');

const validateLogin = [
  body('username').trim().isLength({ min: 2, max: 30 }).withMessage('Username debe tener 2-30 caracteres'),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Password requerido'),
];

const validateAddToken = [
  body('symbol').trim().isLength({ min: 2, max: 10 }).isAlphanumeric().withMessage('Symbol invalido (2-10 alfanumericos)'),
  body('name').optional().trim().isLength({ max: 50 }).withMessage('Nombre demasiado largo'),
];

const validateCreateUser = [
  body('username').trim().isLength({ min: 2, max: 30 }).isAlphanumeric().withMessage('Username invalido'),
  body('password').isLength({ min: 4, max: 128 }).withMessage('Password debe tener 4-128 caracteres'),
  body('role').optional().isIn(['admin', 'moderator', 'user']).withMessage('Rol invalido'),
];

const validateTrade = [
  body('symbol').trim().isLength({ min: 2, max: 10 }).isAlphanumeric().withMessage('Symbol invalido'),
  body('amount').optional().isFloat({ min: 1, max: 1000000 }).withMessage('Amount invalido'),
  body('timeframe').optional().isIn(['15m', '1h', '4h', '1d']).withMessage('Timeframe invalido'),
];

function handleValidationErrors(req, res, next) {
  const { validationResult } = require('express-validator');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  next();
}

module.exports = { validateLogin, validateAddToken, validateCreateUser, validateTrade, handleValidationErrors };
