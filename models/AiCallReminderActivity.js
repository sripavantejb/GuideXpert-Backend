const mongoose = require('mongoose');

const AI_CALL_REMINDER_ACTIONS = [
  'reminder_created',
  'reminder_updated',
  'reminder_scheduled',
  'reminder_rejected',
  'reminder_rescheduled',
  'reminder_failed',
  'reminder_retried',
  'reminder_cancelled',
  'test_call_triggered',
];

const aiCallReminderActivitySchema = new mongoose.Schema({
  reminderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiCallReminder',
    default: null,
    index: true,
  },
  testCallId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiTestCall',
    default: null,
    index: true,
  },
  actorType: {
    type: String,
    enum: ['admin', 'system'],
    default: 'admin',
  },
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
  },
  actorName: { type: String, trim: true, maxlength: 100, default: null },
  action: {
    type: String,
    enum: AI_CALL_REMINDER_ACTIONS,
    required: true,
    index: true,
  },
  oldValue: { type: String, trim: true, maxlength: 500, default: null },
  newValue: { type: String, trim: true, maxlength: 500, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
  collection: 'aiCallReminderActivities',
});

aiCallReminderActivitySchema.index({ reminderId: 1, createdAt: -1 });

module.exports = mongoose.model('AiCallReminderActivity', aiCallReminderActivitySchema);
module.exports.AI_CALL_REMINDER_ACTIONS = AI_CALL_REMINDER_ACTIONS;
