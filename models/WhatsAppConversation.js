const mongoose = require('mongoose');
const { PRODUCT_LINES, CONVERSATION_STATUSES } = require('../constants/chatbotStates');

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

const whatsAppConversationSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'Phone must be 10 digits'],
      index: true,
    },
    productLine: {
      type: String,
      required: true,
      enum: PRODUCT_LINES,
      default: 'unknown',
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: CONVERSATION_STATUSES,
      default: 'active',
      index: true,
    },
    formSubmissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FormSubmission',
      default: null,
    },
    iitCounsellingSubmissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'IitCounsellingSubmission',
      default: null,
    },
    lastInboundAt: { type: Date, default: null, index: true },
    lastOutboundAt: { type: Date, default: null },
    sessionExpiresAt: { type: Date, default: null, index: true },
    currentHandoffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppAgentHandoff',
      default: null,
    },
    messageCount: { type: Number, default: 0, min: 0 },
    lastIntent: { type: String, trim: true, maxlength: 64, default: null },
    preferredLanguage: {
      type: String,
      enum: ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr', 'bn'],
      default: 'en',
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true }
);

whatsAppConversationSchema.index({ phone: 1, updatedAt: -1 });
whatsAppConversationSchema.index({ status: 1, sessionExpiresAt: 1 });
whatsAppConversationSchema.index(
  { phone: 1, productLine: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['active', 'handoff'] } },
  }
);
whatsAppConversationSchema.index(
  { iitCounsellingSubmissionId: 1 },
  { partialFilterExpression: { iitCounsellingSubmissionId: { $type: 'objectId' } } }
);
whatsAppConversationSchema.index(
  { formSubmissionId: 1 },
  { partialFilterExpression: { formSubmissionId: { $type: 'objectId' } } }
);

whatsAppConversationSchema.statics.SESSION_WINDOW_MS = SESSION_WINDOW_MS;

whatsAppConversationSchema.methods.refreshSessionWindow = function refreshSessionWindow(now = new Date()) {
  this.lastInboundAt = now;
  this.sessionExpiresAt = new Date(now.getTime() + SESSION_WINDOW_MS);
};

module.exports = mongoose.model('WhatsAppConversation', whatsAppConversationSchema);
