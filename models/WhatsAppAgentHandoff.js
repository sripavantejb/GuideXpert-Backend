const mongoose = require('mongoose');
const {
  PRODUCT_LINES,
  HANDOFF_STATUSES,
  HANDOFF_ROUTES,
  HANDOFF_REASONS,
} = require('../constants/chatbotStates');

const whatsAppAgentHandoffSchema = new mongoose.Schema(
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
    productLine: {
      type: String,
      required: true,
      enum: PRODUCT_LINES,
      default: 'unknown',
    },
    status: {
      type: String,
      required: true,
      enum: HANDOFF_STATUSES,
      default: 'open',
      index: true,
    },
    route: {
      type: String,
      required: true,
      enum: HANDOFF_ROUTES,
      default: 'admin_pool',
    },
    assignedBdaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bda',
      default: null,
      index: true,
    },
    assignedAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
      index: true,
    },
    claimedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    reason: {
      type: String,
      enum: HANDOFF_REASONS,
      default: 'user_requested',
    },
    userLastMessage: { type: String, maxlength: 2000, default: null },
    summaryForAgent: { type: String, maxlength: 4000, default: null },
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
    lastAgentMessageAt: { type: Date, default: null },
    botPaused: { type: Boolean, default: true },
    createdBy: {
      type: String,
      enum: ['bot', 'admin', 'bda'],
      default: 'bot',
    },
  },
  { timestamps: true }
);

whatsAppAgentHandoffSchema.index({ status: 1, route: 1, createdAt: -1 });
whatsAppAgentHandoffSchema.index(
  { assignedBdaId: 1, status: 1 },
  { partialFilterExpression: { assignedBdaId: { $type: 'objectId' } } }
);
whatsAppAgentHandoffSchema.index(
  { assignedAdminId: 1, status: 1 },
  { partialFilterExpression: { assignedAdminId: { $type: 'objectId' } } }
);
whatsAppAgentHandoffSchema.index({ conversationId: 1, status: 1 });

module.exports = mongoose.model('WhatsAppAgentHandoff', whatsAppAgentHandoffSchema);
