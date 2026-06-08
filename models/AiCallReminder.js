const mongoose = require('mongoose');

const AI_CALL_REMINDER_STATUSES = [
  'pending_approval',
  'scheduled',
  'processing',
  'completed',
  'failed',
  'cancelled',
];

const aiCallReminderSchema = new mongoose.Schema({
  iitCounsellingSubmissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IitCounsellingSubmission',
    index: true,
    unique: true,
    sparse: true,
  },
  studentName: { type: String, trim: true, maxlength: 255 },
  parentName: { type: String, trim: true, maxlength: 255, default: null },
  phone: {
    type: String,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits'],
    index: true,
  },
  email: { type: String, trim: true, maxlength: 255, default: null },
  class: { type: String, trim: true, maxlength: 100, default: null },
  city: { type: String, trim: true, maxlength: 255, default: null },
  school: { type: String, trim: true, maxlength: 255, default: null },
  biggestConcern: { type: String, trim: true, maxlength: 500, default: null },
  careerGoal: { type: String, trim: true, maxlength: 500, default: null },
  additionalNotes: { type: String, trim: true, maxlength: 2000, default: null },
  selectedSlot: { type: String, trim: true, maxlength: 255 },
  selectedSlotInstantUtc: { type: Date, default: null },
  callbackTime: { type: Date, index: true },
  slotDayIst: { type: String, trim: true, index: true },
  status: {
    type: String,
    enum: AI_CALL_REMINDER_STATUSES,
    default: 'pending_approval',
    index: true,
  },
  rejectedAt: { type: Date, default: null },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  rejectionReason: { type: String, trim: true, maxlength: 500, default: null },
  scheduledAt: { type: Date, default: null },
  scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  osviRequest: { type: mongoose.Schema.Types.Mixed, default: null },
  osviResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  osviCallbackId: { type: String, trim: true, default: null },
  lastError: { type: String, trim: true, maxlength: 1000, default: null },
  retryCount: { type: Number, default: 0, min: 0 },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'aiCallReminders',
});

aiCallReminderSchema.index({ status: 1, callbackTime: 1 });
aiCallReminderSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AiCallReminder', aiCallReminderSchema);
module.exports.AI_CALL_REMINDER_STATUSES = AI_CALL_REMINDER_STATUSES;
