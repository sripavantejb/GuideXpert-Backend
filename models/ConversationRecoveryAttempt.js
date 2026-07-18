'use strict';

const mongoose = require('mongoose');

const DELIVERY_STATUSES = Object.freeze([
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'expired',
  'blocked',
  'retry_pending',
]);

const FAILURE_REASONS = Object.freeze([
  'invalid_number',
  'blocked',
  'opt_out',
  'template_failure',
  'template_rejected',
  'template_missing',
  'api_failure',
  'rate_limit',
  'unknown',
  null,
]);

const conversationRecoveryAttemptSchema = new mongoose.Schema(
  {
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ConversationRecoveryCase',
      required: true,
      index: true,
    },
    phone: { type: String, required: true, match: [/^\d{10}$/, '10-digit phone'], index: true },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    attemptNumber: { type: Number, required: true, min: 1 },
    /** Unique send key: conversationId:conversation_recovery:attemptNumber */
    idempotencyKey: { type: String, default: null },
    campaign: { type: String, default: 'conversation_recovery', index: true },
    scheduledFor: { type: Date, required: true, index: true },
    messageKind: { type: String, default: 'conversation_recovery', index: true },
    templateId: { type: String, default: null },
    messageBody: { type: String, default: null },
    lastPhase: { type: Number, default: null },
    deliveryStatus: {
      type: String,
      enum: DELIVERY_STATUSES,
      default: 'queued',
      index: true,
    },
    failureReason: {
      type: String,
      enum: FAILURE_REASONS,
      default: null,
    },
    gupshupMessageId: { type: String, default: null, index: true },
    gupshupInternalMessageId: { type: String, default: null, index: true },
    whatsappMessageEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppMessageEvent',
      default: null,
      index: true,
    },
    queuedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    repliedAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
    claimToken: { type: String, default: null },
    processingStartedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

conversationRecoveryAttemptSchema.index({ caseId: 1, attemptNumber: 1 }, { unique: true });
conversationRecoveryAttemptSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
conversationRecoveryAttemptSchema.index({ deliveryStatus: 1, scheduledFor: 1 });
conversationRecoveryAttemptSchema.index({ phone: 1, createdAt: -1 });

module.exports =
  mongoose.models.ConversationRecoveryAttempt ||
  mongoose.model('ConversationRecoveryAttempt', conversationRecoveryAttemptSchema);
module.exports.DELIVERY_STATUSES = DELIVERY_STATUSES;
module.exports.FAILURE_REASONS = FAILURE_REASONS;
