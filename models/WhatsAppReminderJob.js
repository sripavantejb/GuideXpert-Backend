const mongoose = require('mongoose');

const CAMPAIGN_MESSAGE_KINDS = ['pre4hr', 'meet', '30min'];
const IIT_REMINDER_MESSAGE_KINDS = ['iit_pre2hr', 'iit_pre45min', 'iit_pre15min'];
const ALL_REMINDER_JOB_MESSAGE_KINDS = [...CAMPAIGN_MESSAGE_KINDS, ...IIT_REMINDER_MESSAGE_KINDS];

const JOB_STATES = [
  'pending',
  'claimed',
  'dispatching',
  'dispatched',
  'delivered',
  'read',
  'failed',
  'reconcile_pending',
  'exhausted',
  'cancelled',
  'skipped'
];

const whatsAppReminderJobSchema = new mongoose.Schema({
  formSubmissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FormSubmission',
    default: null,
    index: true
  },
  iitCounsellingSubmissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IitCounsellingSubmission',
    default: null,
    index: true
  },
  phone: {
    type: String,
    required: true,
    match: [/^\d{10}$/, '10-digit phone'],
    index: true
  },
  messageKind: {
    type: String,
    required: true,
    enum: ALL_REMINDER_JOB_MESSAGE_KINDS,
    index: true
  },
  opsProduct: {
    type: String,
    enum: ['guidexpert', 'iit_counselling'],
    default: 'guidexpert',
    index: true
  },
  preferredLanguage: {
    type: String,
    enum: ['Telugu', 'Hindi'],
    default: null
  },
  slotBookingLabel: {
    type: String,
    trim: true,
    maxlength: 64,
    default: null
  },
  templateIdEnvKey: {
    type: String,
    trim: true,
    maxlength: 128,
    default: null
  },
  slotDate: { type: Date, required: true, index: true },
  slotDayIst: { type: String, trim: true, maxlength: 10, required: true, index: true },
  scheduledSendAt: { type: Date, required: true, index: true },
  expiresAt: { type: Date, default: null, index: true },
  expiredAt: { type: Date, default: null },
  firstEligibleAt: { type: Date, required: true },
  retryGroupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppRetryGroup',
    required: true,
    index: true
  },
  state: {
    type: String,
    enum: JOB_STATES,
    default: 'pending',
    index: true
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
  providerMessageId: { type: String, trim: true, maxlength: 256, default: null },
  rootMessageEventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppMessageEvent',
    default: null
  },
  cronRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'MessagingCronRun', default: null },
  initialMessageEventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppMessageEvent',
    default: null
  },
  latestMessageEventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppMessageEvent',
    default: null
  },
  dispatchedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  executionMetadata: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

whatsAppReminderJobSchema.pre('validate', function validateSubmissionLink() {
  const hasGx = Boolean(this.formSubmissionId);
  const hasIit = Boolean(this.iitCounsellingSubmissionId);
  if (hasGx === hasIit) {
    this.invalidate('formSubmissionId', 'exactly one of formSubmissionId or iitCounsellingSubmissionId is required');
  }
});

whatsAppReminderJobSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

whatsAppReminderJobSchema.index(
  { formSubmissionId: 1, messageKind: 1 },
  { unique: true, partialFilterExpression: { formSubmissionId: { $type: 'objectId' } } }
);
whatsAppReminderJobSchema.index(
  { iitCounsellingSubmissionId: 1, messageKind: 1 },
  { unique: true, partialFilterExpression: { iitCounsellingSubmissionId: { $type: 'objectId' } } }
);
whatsAppReminderJobSchema.index({ state: 1, scheduledSendAt: 1 });
whatsAppReminderJobSchema.index({ slotDayIst: 1, messageKind: 1, state: 1 });
whatsAppReminderJobSchema.index({ opsProduct: 1, messageKind: 1, state: 1 });

module.exports = mongoose.model('WhatsAppReminderJob', whatsAppReminderJobSchema);
module.exports.CAMPAIGN_MESSAGE_KINDS = CAMPAIGN_MESSAGE_KINDS;
module.exports.IIT_REMINDER_MESSAGE_KINDS = IIT_REMINDER_MESSAGE_KINDS;
module.exports.ALL_REMINDER_JOB_MESSAGE_KINDS = ALL_REMINDER_JOB_MESSAGE_KINDS;
module.exports.JOB_STATES = JOB_STATES;
