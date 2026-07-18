'use strict';

const mongoose = require('mongoose');

/** Lightweight scheduler/ops run trail for health + system metrics. */
const conversationRecoverySchedulerRunSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true, index: true },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
    success: { type: Boolean, default: false },
    scanned: { type: Number, default: 0 },
    scheduled: { type: Number, default: 0 },
    claimed: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skippedIdempotent: { type: Number, default: 0 },
    skippedWindow: { type: Number, default: 0 },
    skippedDailyLimit: { type: Number, default: 0 },
    errorSummary: { type: String, default: null },
    trigger: { type: String, default: 'cron' },
  },
  { timestamps: true }
);

conversationRecoverySchedulerRunSchema.index({ startedAt: -1 });

module.exports =
  mongoose.models.ConversationRecoverySchedulerRun ||
  mongoose.model('ConversationRecoverySchedulerRun', conversationRecoverySchedulerRunSchema);
