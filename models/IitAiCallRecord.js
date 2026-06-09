const mongoose = require('mongoose');

const IIT_AI_CALL_OUTCOMES = [
  'Confirmed',
  'Undecided',
  'Not Interested',
  'No Answer',
  'Reschedule Requested',
];

const IIT_AI_CALL_CONFIRMATIONS = ['YES', 'NO', 'MAYBE', 'NO_ANSWER'];

const iitAiCallRecordSchema = new mongoose.Schema({
  callLogId: { type: String, trim: true, required: true, unique: true, index: true },
  phone: { type: String, trim: true, index: true },
  personName: { type: String, trim: true, maxlength: 255, default: null },
  agentName: { type: String, trim: true, maxlength: 255, default: null },
  callStatus: { type: String, trim: true, maxlength: 100, default: null },
  callType: { type: String, trim: true, maxlength: 100, default: null },
  duration: { type: Number, default: null },
  recordingUrl: { type: String, trim: true, default: null },
  callTime: { type: Date, default: null, index: true },
  summary: { type: String, trim: true, default: null },
  transcript: { type: String, default: null },
  confirmation: { type: String, trim: true, default: null },
  callOutcome: { type: String, trim: true, default: null, index: true },
  studentConcern: { type: String, trim: true, default: null },
  examAttempted: { type: String, trim: true, default: null },
  timeConfirmed: { type: String, trim: true, default: null },
  rescheduleRequested: { type: String, trim: true, default: null },
  preferredCallbackTime: { type: String, trim: true, default: null },
  structuredOutput: { type: mongoose.Schema.Types.Mixed, default: null },
  triggerData: { type: mongoose.Schema.Types.Mixed, default: null },
  aiCallReminderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiCallReminder',
    default: null,
    index: true,
  },
  rawPayload: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'iitAiCallRecords',
});

iitAiCallRecordSchema.index({ createdAt: -1 });
iitAiCallRecordSchema.index({ callOutcome: 1, createdAt: -1 });

module.exports = mongoose.model('IitAiCallRecord', iitAiCallRecordSchema);
module.exports.IIT_AI_CALL_OUTCOMES = IIT_AI_CALL_OUTCOMES;
module.exports.IIT_AI_CALL_CONFIRMATIONS = IIT_AI_CALL_CONFIRMATIONS;
