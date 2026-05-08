const mongoose = require('mongoose');

/**
 * Frozen chart payload keyed by deterministic scopeKey ("summary:all:from:to" |
 * "day:pre4hr:2026-05-08" | "month:meet:2026-05"). Upserted on capture so the
 * UI can read a stable dataset even while live WhatsAppMessageEvent rows mutate.
 */
const whatsAppOpsChartSnapshotSchema = new mongoose.Schema(
  {
    scopeKey: { type: String, required: true, unique: true, maxlength: 200 },
    scope: {
      type: String,
      required: true,
      enum: ['summary', 'month', 'day']
    },
    messageKind: {
      type: String,
      trim: true,
      maxlength: 32,
      default: null,
      index: true
    },
    range: {
      monthIso: { type: String, trim: true, maxlength: 7, default: null },
      dateIso: { type: String, trim: true, maxlength: 10, default: null },
      fromIso: { type: String, trim: true, maxlength: 32, default: null },
      toIso: { type: String, trim: true, maxlength: 32, default: null }
    },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    capturedAt: { type: Date, default: Date.now, index: true },
    capturedBy: { type: String, trim: true, maxlength: 100, default: null }
  },
  { minimize: false }
);

whatsAppOpsChartSnapshotSchema.index({ scope: 1, capturedAt: -1 });

module.exports = mongoose.model('WhatsAppOpsChartSnapshot', whatsAppOpsChartSnapshotSchema);
