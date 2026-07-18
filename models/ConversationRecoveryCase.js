'use strict';

const mongoose = require('mongoose');

const CASE_STATUSES = Object.freeze([
  'eligible',
  'scheduled',
  'active',
  'awaiting_reply',
  'recovered',
  'stopped',
  'opted_out',
  'exhausted',
  'paused',
]);

const conversationRecoveryCaseSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, match: [/^\d{10}$/, '10-digit phone'], index: true },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    snapshotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ConversationRecoverySnapshot',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: CASE_STATUSES,
      default: 'eligible',
      index: true,
    },
    attemptCount: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 3, min: 1 },
    nextAttemptAt: { type: Date, default: null, index: true },
    lastAttemptAt: { type: Date, default: null },
    lastPhase: { type: Number, default: null, index: true },
    lastStage: { type: String, default: null },
    paused: { type: Boolean, default: false, index: true },
    stopped: { type: Boolean, default: false, index: true },
    stopReason: { type: String, default: null },
    recoveredAt: { type: Date, default: null },
    journeyCompletedAfterRecovery: { type: Boolean, default: false },
    bookingCompletedAfterRecovery: { type: Boolean, default: false },
    assignedHumanAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

conversationRecoveryCaseSchema.index({ phone: 1, conversationId: 1 }, { unique: true });
conversationRecoveryCaseSchema.index({ status: 1, nextAttemptAt: 1 });
conversationRecoveryCaseSchema.index({ paused: 1, stopped: 1, status: 1 });

module.exports =
  mongoose.models.ConversationRecoveryCase ||
  mongoose.model('ConversationRecoveryCase', conversationRecoveryCaseSchema);
module.exports.CASE_STATUSES = CASE_STATUSES;
