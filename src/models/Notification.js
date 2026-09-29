/**
 * models/Notification.js
 * In-app notification documents.
 */

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['weekly_summary', 'streak_break', 'goal_achieved', 'general'],
      default: 'general',
    },

    title: {
      type: String,
      required: true,
      maxlength: 120,
    },

    body: {
      type: String,
      default: '',
      maxlength: 500,
    },

    read: {
      type: Boolean,
      default: false,
      index: true,
    },

    // Optional deep-link within the app (e.g. '/app/dashboard')
    linkTo: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index for efficient per-user queries
notificationSchema.index({ userId: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
