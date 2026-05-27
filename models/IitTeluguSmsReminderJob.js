const mongoose = require('mongoose');

const IIT_TELUGU_SMS_MESSAGE_KINDS = [
  'iit_sms_tminus_1d',
  'iit_sms_tminus_2h',
  'iit_sms_session_8am',
  'iit_sms_tminus_30m',
  'iit_sms_tminus_5m',
  'iit_sms_tplus_5m',
];

const JOB_STATES = [
  'pending',
  'claimed',
  'dispatching',
  'dispatched',
  'failed',
  'exhausted',
  'cancelled',
  'skipped',
];

const iitTeluguSmsReminderJobSchema = new mongoose.Schema({
  iitCounsellingSubmissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IitCounsellingSubmission',
    required: true,
    index: true,
  },
  phone: {
    type: String,
    required: true,
    match: [/^\d{10}$/, '10-digit phone'],
    index: true,
  },
  messageKind: {
    type: String,
    required: true,
    enum: IIT_TELUGU_SMS_MESSAGE_KINDS,
    index: true,
  },
  preferredLanguage: {
    type: String,
    enum: ['Telugu'],
    default: 'Telugu',
  },
  slotBookingLabel: {
    type: String,
    trim: true,
    maxlength: 64,
    default: null,
  },
  msg91TemplateId: {
    type: String,
    trim: true,
    maxlength: 32,
    required: true,
  },
  templateVariables: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  noBackfill: {
    type: Boolean,
    default: true,
  },
  sendImmediately: {
    type: Boolean,
    default: false,
  },
  slotDate: { type: Date, required: true, index: true },
  slotDayIst: { type: String, trim: true, maxlength: 10, required: true, index: true },
  scheduledSendAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, default: null, index: true },
  expiredAt: { type: Date, default: null },
  firstEligibleAt: { type: Date, required: true },
  state: {
    type: String,
    enum: JOB_STATES,
    default: 'pending',
    index: true,
  },
  scheduleVersion: { type: Number, default: 1, min: 1 },
  attempts: { type: Number, default: 0, min: 0 },
  lastError: { type: String, trim: true, maxlength: 2000, default: null },
  suppressionReason: { type: String, trim: true, maxlength: 64, default: null },
  claimedUntil: { type: Date, default: null, index: true },
  leaseExpiresAt: { type: Date, default: null, index: true },
  claimedAt: { type: Date, default: null },
  claimedBy: { type: String, trim: true, maxlength: 128, default: null },
  claimToken: { type: String, trim: true, maxlength: 64, default: null },
  cronRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'MessagingCronRun', default: null },
  dispatchedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  providerResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  executionMetadata: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

iitTeluguSmsReminderJobSchema.pre('save', function onSave() {
  this.updatedAt = Date.now();
});

iitTeluguSmsReminderJobSchema.index(
  { iitCounsellingSubmissionId: 1, messageKind: 1 },
  { unique: true }
);
iitTeluguSmsReminderJobSchema.index({ state: 1, scheduledSendAt: 1 });
iitTeluguSmsReminderJobSchema.index({ slotDayIst: 1, messageKind: 1, state: 1 });

module.exports = mongoose.model('IitTeluguSmsReminderJob', iitTeluguSmsReminderJobSchema);
module.exports.IIT_TELUGU_SMS_MESSAGE_KINDS = IIT_TELUGU_SMS_MESSAGE_KINDS;
module.exports.JOB_STATES = JOB_STATES;
