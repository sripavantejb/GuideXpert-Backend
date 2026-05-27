const mongoose = require('mongoose');

/** Single source of truth for MessagingCronRun.jobKey — keep in sync with cron routes and dispatcher. */
const CRON_JOB_KEYS = Object.freeze({
  SEND_REMINDERS: 'send_reminders',
  SEND_MEETLINKS: 'send_meetlinks',
  SEND_30MIN_REMINDERS: 'send_30min_reminders',
  RETRY_WHATSAPP: 'retry_whatsapp',
  SEND_IIT_REMINDERS: 'send_iit_reminders',
  SEND_IIT_TELUGU_SMS: 'send_iit_telugu_sms',
});

const CRON_JOB_KEY_LIST = Object.freeze(Object.values(CRON_JOB_KEYS));

const statsSchema = new mongoose.Schema(
  {
    found: { type: Number, default: 0 },
    smsSent: { type: Number, default: 0 },
    smsFailed: { type: Number, default: 0 },
    waAttempted: { type: Number, default: 0 },
    waSucceeded: { type: Number, default: 0 },
    waFailed: { type: Number, default: 0 },
    retriesAttempted: { type: Number, default: 0 },
    flagsUpdated: { type: Number, default: 0 }
  },
  { _id: false }
);

const messagingCronRunSchema = new mongoose.Schema({
  jobKey: {
    type: String,
    required: true,
    enum: CRON_JOB_KEY_LIST
  },
  startedAt: { type: Date, required: true, default: Date.now },
  finishedAt: { type: Date, default: null },
  durationMs: { type: Number, default: null },
  success: { type: Boolean, default: false },
  stats: { type: statsSchema, default: () => ({}) },
  errorSummary: { type: String, maxlength: 2000, default: null },
  trigger: {
    type: String,
    enum: ['cron', 'manual', 'system'],
    default: 'cron'
  },
  triggeredBy: { type: String, trim: true, maxlength: 100, default: null }
});

messagingCronRunSchema.index({ jobKey: 1, startedAt: -1 });
messagingCronRunSchema.index({ startedAt: -1 });

module.exports = mongoose.model('MessagingCronRun', messagingCronRunSchema);
module.exports.CRON_JOB_KEYS = CRON_JOB_KEYS;
module.exports.CRON_JOB_KEY_LIST = CRON_JOB_KEY_LIST;
