'use strict';

const mongoose = require('mongoose');

const conversationRecoveryAuditLogSchema = new mongoose.Schema(
  {
    adminId: { type: String, default: null, index: true },
    adminEmail: { type: String, default: null, index: true },
    action: { type: String, required: true, index: true },
    targetCaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ConversationRecoveryCase',
      default: null,
      index: true,
    },
    targetPhone: { type: String, default: null, index: true },
    targetStudent: { type: String, default: null },
    reason: { type: String, default: null },
    ip: { type: String, default: null },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

conversationRecoveryAuditLogSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.ConversationRecoveryAuditLog ||
  mongoose.model('ConversationRecoveryAuditLog', conversationRecoveryAuditLogSchema);
