const mongoose = require('mongoose');

const whatsAppMessageEventSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true, match: [/^\d{10}$/, '10-digit phone'] },
  formSubmissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormSubmission', index: true, default: null },
  messageKind: {
    type: String,
    required: true,
    enum: ['slot_booked', 'pre4hr', 'meet', '30min']
  },
  cronRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'MessagingCronRun', default: null, index: true },
  cronJobKey: {
    type: String,
    default: null,
    maxlength: 64
  },
  source: {
    type: String,
    required: true,
    enum: ['save_step3', 'cron', 'retry_cron', 'admin_manual']
  },
  templateIdEnvKey: { type: String, trim: true, maxlength: 64, default: null },
  templateId: { type: String, trim: true, maxlength: 128, default: null },
  gupshupMessageId: { type: String, trim: true, maxlength: 128, default: null, index: true },
  providerAcceptedAt: { type: Date, default: null },
  providerPayloadSnippet: { type: String, maxlength: 1200, default: null },
  status: {
    type: String,
    required: true,
    enum: [
      'queued',
      'submitted',
      'failed',
      'delivered',
      'read',
      'retry_pending',
      'retry_exhausted'
    ],
    default: 'submitted'
  },
  retryCountSnapshot: { type: Number, default: null },
  errorMessage: { type: String, maxlength: 2000, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

whatsAppMessageEventSchema.index({ createdAt: -1 });
whatsAppMessageEventSchema.index({ phone: 1, messageKind: 1, createdAt: -1 });
whatsAppMessageEventSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('WhatsAppMessageEvent', whatsAppMessageEventSchema);
