'use strict';

const mongoose = require('mongoose');

const SEVERITIES = Object.freeze(['info', 'warning', 'critical']);
const STATUSES = Object.freeze(['open', 'acknowledged', 'resolved']);

const conversationRecoveryAlertSchema = new mongoose.Schema(
  {
    alertKey: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    severity: { type: String, enum: SEVERITIES, default: 'warning', index: true },
    status: { type: String, enum: STATUSES, default: 'open', index: true },
    metric: { type: String, default: null },
    value: { type: Number, default: null },
    threshold: { type: Number, default: null },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

conversationRecoveryAlertSchema.index({ alertKey: 1, status: 1 });
conversationRecoveryAlertSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.ConversationRecoveryAlert ||
  mongoose.model('ConversationRecoveryAlert', conversationRecoveryAlertSchema);
module.exports.SEVERITIES = SEVERITIES;
module.exports.STATUSES = STATUSES;
