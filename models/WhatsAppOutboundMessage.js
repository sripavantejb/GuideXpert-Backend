const mongoose = require('mongoose');
const {
  OUTBOUND_MESSAGE_TYPES,
  OUTBOUND_SENDER_TYPES,
  OUTBOUND_STATUSES,
} = require('../constants/chatbotStates');

const whatsAppOutboundMessageSchema = new mongoose.Schema(
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
    senderType: {
      type: String,
      required: true,
      enum: OUTBOUND_SENDER_TYPES,
      default: 'bot',
    },
    senderAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    senderBdaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bda',
      default: null,
    },
    messageType: {
      type: String,
      required: true,
      enum: OUTBOUND_MESSAGE_TYPES,
      default: 'text',
    },
    content: { type: mongoose.Schema.Types.Mixed, default: null },
    textPreview: { type: String, maxlength: 500, default: null },
    gupshupMessageId: { type: String, trim: true, maxlength: 256, default: null, index: true },
    gupshupInternalMessageId: { type: String, trim: true, maxlength: 256, default: null, index: true },
    whatsappWaMessageId: { type: String, trim: true, maxlength: 256, default: null, index: true },
    status: {
      type: String,
      required: true,
      enum: OUTBOUND_STATUSES,
      default: 'queued',
      index: true,
    },
    webhookErrorCode: { type: String, trim: true, maxlength: 32, default: null },
    webhookErrorReason: { type: String, trim: true, maxlength: 2000, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    providerPayloadSnippet: { type: String, maxlength: 1200, default: null },
    inReplyToInboundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppInboundMessage',
      default: null,
    },
    handoffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppAgentHandoff',
      default: null,
    },
  },
  { timestamps: true }
);

whatsAppOutboundMessageSchema.index({ conversationId: 1, createdAt: -1 });
whatsAppOutboundMessageSchema.index({ phone: 1, createdAt: -1 });
whatsAppOutboundMessageSchema.index({ status: 1, updatedAt: -1 });
whatsAppOutboundMessageSchema.index(
  { inReplyToInboundId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      senderType: 'bot',
      inReplyToInboundId: { $type: 'objectId' },
    },
  }
);

module.exports = mongoose.model('WhatsAppOutboundMessage', whatsAppOutboundMessageSchema);
