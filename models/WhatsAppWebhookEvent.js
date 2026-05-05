const mongoose = require('mongoose');

const whatsAppWebhookEventSchema = new mongoose.Schema({
  receivedAt: { type: Date, default: Date.now, index: true },
  messageId: { type: String, trim: true, maxlength: 128, default: null, index: true },
  phone: { type: String, trim: true, default: null, index: true },
  status: { type: String, trim: true, maxlength: 64, default: null },
  formSubmissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FormSubmission', default: null, index: true },
  rawPayloadSnippet: { type: String, maxlength: 4000, default: null },
  matchedBy: { type: String, trim: true, maxlength: 32, default: null },
  matchConfidence: { type: String, trim: true, maxlength: 32, default: null },
  parseError: { type: String, trim: true, maxlength: 512, default: null }
});

whatsAppWebhookEventSchema.index({ receivedAt: -1 });

module.exports = mongoose.model('WhatsAppWebhookEvent', whatsAppWebhookEventSchema);
