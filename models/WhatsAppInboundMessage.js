const mongoose = require('mongoose');
const {
  INBOUND_MESSAGE_TYPES,
  INBOUND_PROCESS_STATUSES,
} = require('../constants/chatbotStates');

const whatsAppInboundMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/],
      index: true,
    },
    providerMessageId: { type: String, trim: true, maxlength: 256, default: null },
    messageType: {
      type: String,
      required: true,
      enum: INBOUND_MESSAGE_TYPES,
      default: 'unknown',
    },
    text: { type: String, maxlength: 4096, default: null },
    interactivePayload: { type: mongoose.Schema.Types.Mixed, default: null },
    mediaUrl: { type: String, trim: true, maxlength: 2000, default: null },
    location: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      name: { type: String, trim: true, maxlength: 256, default: null },
      address: { type: String, trim: true, maxlength: 512, default: null },
    },
    rawPayloadSnippet: { type: String, maxlength: 2000, default: null },
    receivedAt: { type: Date, default: Date.now, index: true },
    processedAt: { type: Date, default: null },
    processStatus: {
      type: String,
      required: true,
      enum: INBOUND_PROCESS_STATUSES,
      default: 'pending',
      index: true,
    },
    processError: { type: String, maxlength: 2000, default: null },
    intent: { type: String, trim: true, maxlength: 64, default: null },
    dedupeKey: { type: String, trim: true, maxlength: 128, default: null },
    whatsappWebhookEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppWebhookEvent',
      default: null,
    },
  },
  { timestamps: true }
);

whatsAppInboundMessageSchema.index(
  { providerMessageId: 1 },
  { unique: true, partialFilterExpression: { providerMessageId: { $type: 'string', $ne: '' } } }
);
whatsAppInboundMessageSchema.index({ conversationId: 1, receivedAt: -1 });
whatsAppInboundMessageSchema.index({ phone: 1, receivedAt: -1 });
whatsAppInboundMessageSchema.index({ processStatus: 1, receivedAt: 1 });

module.exports = mongoose.model('WhatsAppInboundMessage', whatsAppInboundMessageSchema);
