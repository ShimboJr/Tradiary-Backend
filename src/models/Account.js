/**
 * models/Account.js
 * A trading account (live or paper). Every trade belongs to one account.
 */

const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Account name is required.'],
      trim: true,
      maxlength: [80, 'Account name cannot exceed 80 characters.'],
    },
    type: {
      type: String,
      enum: ['live', 'paper'],
      default: 'live',
    },
    broker: {
      type: String,
      trim: true,
      default: '',
    },
    startingBalance: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'USD',
      maxlength: 5,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const Account = mongoose.model('Account', accountSchema);
module.exports = Account;
