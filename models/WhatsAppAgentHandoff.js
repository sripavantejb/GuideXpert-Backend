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
    assignedSrCounsellor: {
      type: String,
      enum: ['sr1', 'sr2'],
      default: null,
      index: true,
    },
    assignedAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
      index: true,
    },
    lastRoutingDecision: {
      mode: { type: String, maxlength: 32, default: null },
      reason: { type: String, maxlength: 64, default: null },
      fallbackUsed: { type: Boolean, default: false },
      fallbackRole: { type: String, maxlength: 32, default: null },
      at: { type: Date, default: null },
    },
    copilotState: {
      type: String,
      enum: ['pending', 'assigned', 'active', 'resolved', 'reopened'],
      default: 'pending',
      index: true,
    },
    lockVersion: { type: Number, default: 0 },
    isReopened: { type: Boolean, default: false, index: true },
    reopenedAt: { type: Date, default: null },
    assignedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    assignedAt: { type: Date, default: null },
    activeAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
      index: true,
    },
    assignmentLockedAt: { type: Date, default: null },
    repliedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    repliedAt: { type: Date, default: null },
    resolvedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    firstResponseAt: { type: Date, default: null },
    copilotReplies: [
      {
        draftText: { type: String, maxlength: 3500, required: true },
        status: {
          type: String,
          enum: [
            'draft',
            'sending',
            'submitted',
            'sent',
            'delivered',
            'read',
            'failed',
            'simulated',
          ],
          default: 'draft',
        },
        adminId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Admin',
          default: null,
        },
        outboundMessageId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'WhatsAppOutboundMessage',
          default: null,
        },
        suggestedText: { type: String, maxlength: 3500, default: null },
        replySource: {
          type: String,
          enum: ['manual', 'ai_used', 'ai_edited'],
          default: 'manual',
        },
        editRatio: { type: Number, min: 0, max: 1, default: null },
        editClassification: {
          type: String,
          enum: ['unchanged', 'minor_edit', 'moderate_edit', 'major_rewrite', 'manual'],
          default: null,
        },
        editTopic: { type: String, maxlength: 64, default: null },
        editPatterns: [{ type: String, maxlength: 64 }],
        errorMessage: { type: String, maxlength: 500, default: null },
        createdAt: { type: Date, default: Date.now },
        sentAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null },
        readAt: { type: Date, default: null },
        failedAt: { type: Date, default: null },
      },
    ],
    copilotFollowups: [
      {
        category: {
          type: String,
          enum: ['reminder', 'reconnect', 'booking', 'information', 'missed_session'],
          required: true,
        },
        scenario: { type: String, maxlength: 64, default: null },
        purpose: { type: String, maxlength: 500, required: true },
        suggestedMessage: { type: String, maxlength: 3500, required: true },
        priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
        recommendedDelayDays: { type: Number, min: 0, max: 30, default: 0 },
        status: {
          type: String,
          enum: ['suggested', 'sent', 'skipped'],
          default: 'suggested',
        },
        source: { type: String, enum: ['rules', 'llm'], default: 'rules' },
        adminId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Admin',
          default: null,
        },
        replyId: {
          type: mongoose.Schema.Types.ObjectId,
          default: null,
        },
        sentAt: { type: Date, default: null },
        skippedAt: { type: Date, default: null },
        responseReceived: { type: Date, default: null },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    auditTrail: [
      {
        action: { type: String, maxlength: 64, required: true },
        adminId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Admin',
          default: null,
        },
        srCounsellor: { type: String, maxlength: 32, default: null },
        meta: { type: mongoose.Schema.Types.Mixed, default: null },
        at: { type: Date, default: Date.now },
      },
    ],
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
    copilotAiSummary: { type: String, maxlength: 4000, default: null },
    copilotSummaryCacheKey: { type: String, maxlength: 128, default: null, index: true },
    copilotStructuredSummary: {
      studentGoal: { type: String, maxlength: 500, default: null },
      currentConcern: { type: String, maxlength: 500, default: null },
      importantFacts: {
        state: { type: String, maxlength: 128, default: null },
        language: { type: String, maxlength: 64, default: null },
        stream: { type: String, maxlength: 64, default: null },
        rank: { type: String, maxlength: 128, default: null },
        budget: { type: String, maxlength: 128, default: null },
        parentInvolvement: { type: String, maxlength: 128, default: null },
        preferredColleges: { type: String, maxlength: 512, default: null },
        previousBookings: { type: String, maxlength: 512, default: null },
      },
      leadQuality: {
        score: { type: String, maxlength: 32, default: null },
        stage: { type: String, maxlength: 32, default: null },
        confidence: { type: String, maxlength: 32, default: null },
      },
      previousInteractions: { type: String, maxlength: 1500, default: null },
      recommendedNextAction: { type: String, maxlength: 500, default: null },
      source: { type: String, enum: ['rules', 'llm', 'hybrid'], default: 'rules' },
      generatedAt: { type: Date, default: null },
    },
    internalNotes: [
      {
        text: { type: String, maxlength: 2000, required: true },
        authorAdminId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Admin',
          default: null,
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
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
whatsAppAgentHandoffSchema.index({ route: 1, copilotState: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsAppAgentHandoff', whatsAppAgentHandoffSchema);
