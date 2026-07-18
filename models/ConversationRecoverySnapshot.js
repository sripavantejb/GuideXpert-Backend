'use strict';

const mongoose = require('mongoose');

const conversationRecoverySnapshotSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, match: [/^\d{10}$/, '10-digit phone'], index: true },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    productLine: {
      type: String,
      enum: ['guidexpert', 'iit_counselling', 'unknown'],
      default: 'guidexpert',
      index: true,
    },
    lastPhase: { type: Number, default: null, index: true },
    lastStage: { type: String, default: null, index: true },
    lastStep: { type: String, default: null },
    journeyBlob: { type: mongoose.Schema.Types.Mixed, default: {} },
    journeyCompleted: { type: Boolean, default: false, index: true },
    bookingCompleted: { type: Boolean, default: false, index: true },
    optedOut: { type: Boolean, default: false, index: true },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    examName: { type: String, default: null, index: true },
    preferredCourse: { type: String, default: null },
    studentName: { type: String, default: null },
    recoveryEligibleHint: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

conversationRecoverySnapshotSchema.index({ phone: 1, conversationId: 1 }, { unique: true });
conversationRecoverySnapshotSchema.index({
  journeyCompleted: 1,
  bookingCompleted: 1,
  optedOut: 1,
  lastActivityAt: 1,
});

module.exports =
  mongoose.models.ConversationRecoverySnapshot ||
  mongoose.model('ConversationRecoverySnapshot', conversationRecoverySnapshotSchema);
