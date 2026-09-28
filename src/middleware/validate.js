/**
 * middleware/validate.js
 * Thin wrapper around express-validator's validationResult.
 * Usage: add validation chains to a route, then call `validate` as the last middleware
 * before the controller.
 *
 * Example:
 *   router.post('/login', [body('email').isEmail()], validate, loginController)
 */

const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      error: {
        message: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        fields: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      },
    });
  }

  next();
};

module.exports = validate;
