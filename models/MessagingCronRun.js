const mongoose = require('mongoose');

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
    enum: ['send_reminders', 'send_meetlinks', 'send_30min_reminders', 'retry_whatsapp']
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
