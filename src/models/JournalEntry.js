/**
 * models/JournalEntry.js
 * One free-form daily journal entry per user per calendar day.
 */
const mongoose = require('mongoose');

const journalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String, // stored as 'YYYY-MM-DD' — one per day per user
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'],
    },
    mood: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    marketNotes: { type: String, default: '' },
    lessonsLearned: { type: String, default: '' },
  },
  { timestamps: true }
);

// Unique: one entry per user per date
journalSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('JournalEntry', journalSchema);
