/**
 * middleware/validators/authValidators.js
 * express-validator chains for auth endpoints.
 */

const { body, param } = require('express-validator');

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const PASSWORD_MSG =
  'Password must be at least 8 characters and include uppercase, lowercase, and a number.';

const registerValidators = [
  body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 80 }),
  body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail(),
  body('password').matches(PASSWORD_REGEX).withMessage(PASSWORD_MSG),
  body('confirmPassword')
    .custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Passwords do not match.');
      return true;
    }),
];

const loginValidators = [
  body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

const googleValidators = [
  body('credential').notEmpty().withMessage('Google credential is required.'),
];

const forgotPasswordValidators = [
  body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail(),
];

const resetPasswordValidators = [
  param('token').notEmpty(),
  body('password').matches(PASSWORD_REGEX).withMessage(PASSWORD_MSG),
  body('confirmPassword').custom((val, { req }) => {
    if (val !== req.body.password) throw new Error('Passwords do not match.');
    return true;
  }),
];

module.exports = {
  registerValidators,
  loginValidators,
  googleValidators,
  forgotPasswordValidators,
  resetPasswordValidators,
};
