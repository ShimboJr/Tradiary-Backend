/**
 * models/Strategy.js
 * A trading playbook / strategy with checklist rules and example screenshots.
 */
const mongoose = require('mongoose');

const ruleSchema = new mongoose.Schema(
  {
    text:  { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: false }
); // _id auto-generated — used as ruleId in Trade.rulesFollowed

const strategySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Strategy name is required.'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters.'],
    },
    description: { type: String, default: '', maxlength: 2000 },
    rules: { type: [ruleSchema], default: [] },
    exampleScreenshots: { type: [String], default: [] }, // URLs
    color: { type: String, default: '#3b8ef3' }, // for UI color coding
  },
  { timestamps: true }
);

module.exports = mongoose.model('Strategy', strategySchema);
