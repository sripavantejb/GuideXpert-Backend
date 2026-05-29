const mongoose = require('mongoose');

const { WEBHOOK_EVENT_KINDS } = require('../constants/chatbotStates');

const whatsAppWebhookEventSchema = new mongoose.Schema({
  eventKind: {
    type: String,
    enum: WEBHOOK_EVENT_KINDS,
    default: 'dlr',
    index: true,
  },
  inboundMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WhatsAppInboundMessage',
    default: null,
  },
  receivedAt: { type: Date, default: Date.now, index: true },
  /** Stable key so Gupshup retries do not double-apply status updates */
  webhookDedupeKey: { type: String, trim: true, maxlength: 128, default: null, unique: true, sparse: true },
  messageId: { type: String, trim: true, maxlength: 256, default: null, index: true },
  phone: { type: String, trim: true, default: null, index: true },
  status: { type: String, trim: true, maxlength: 64, default: null },
  formSubmissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormSubmission', default: null, index: true },
  rawPayloadSnippet: { type: String, maxlength: 4000, default: null },
  matchedBy: { type: String, trim: true, maxlength: 32, default: null },
  matchConfidence: { type: String, trim: true, maxlength: 32, default: null },
  parseError: { type: String, trim: true, maxlength: 512, default: null },
  isQuarantined: { type: Boolean, default: false, index: true },
  quarantineReason: { type: String, trim: true, maxlength: 128, default: null },
  quarantineCandidateEventIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppMessageEvent' }],
  resolvedMessageEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppMessageEvent', default: null },
  resolvedBy: { type: String, trim: true, maxlength: 32, default: null }
});

whatsAppWebhookEventSchema.index({ receivedAt: -1 });

module.exports = mongoose.model('WhatsAppWebhookEvent', whatsAppWebhookEventSchema);
