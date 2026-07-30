const mongoose = require('mongoose');
const {
  OUTBOUND_MESSAGE_TYPES,
  OUTBOUND_SENDER_TYPES,
  OUTBOUND_STATUSES,
} = require('../constants/chatbotStates');

/** Explicit name for G-2b compound unique partial index (migration + schema). */
const BOT_REPLY_INBOUND_PART_INDEX_NAME = 'bot_reply_inbound_part_unique';

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
    /**
     * Zero-based envelope part index for multi-bubble bot replies.
     * Single-reply callers omit this (defaults to 0). Compound unique with
     * inReplyToInboundId for bot rows (see bot_reply_inbound_part_unique).
     */
    partIndex: {
      type: Number,
      default: 0,
      min: 0,
    },
    handoffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppAgentHandoff',
      default: null,
    },
    copilotReplyId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true }
);

whatsAppOutboundMessageSchema.index({ conversationId: 1, createdAt: -1 });
whatsAppOutboundMessageSchema.index({ phone: 1, createdAt: -1 });
whatsAppOutboundMessageSchema.index({ status: 1, updatedAt: -1 });
whatsAppOutboundMessageSchema.index(
  { inReplyToInboundId: 1, partIndex: 1 },
  {
    name: BOT_REPLY_INBOUND_PART_INDEX_NAME,
    unique: true,
    partialFilterExpression: {
      senderType: 'bot',
      inReplyToInboundId: { $type: 'objectId' },
      partIndex: { $type: 'number' },
    },
  }
);
whatsAppOutboundMessageSchema.index(
  { copilotReplyId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      copilotReplyId: { $type: 'objectId' },
    },
  }
);

const WhatsAppOutboundMessage = mongoose.model(
  'WhatsAppOutboundMessage',
  whatsAppOutboundMessageSchema
);
WhatsAppOutboundMessage.BOT_REPLY_INBOUND_PART_INDEX_NAME = BOT_REPLY_INBOUND_PART_INDEX_NAME;
module.exports = WhatsAppOutboundMessage;
