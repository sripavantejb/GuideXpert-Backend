const mongoose = require('mongoose');

const countersSchema = new mongoose.Schema(
  {
    targeted: { type: Number, default: 0 },
    attempted: { type: Number, default: 0 },
    apiAccepted: { type: Number, default: 0 },
    sendFailed: { type: Number, default: 0 },
    skippedAlreadyDelivered: { type: Number, default: 0 },
    skippedGlobalRecentSuccess: { type: Number, default: 0 },
    skippedInFlightDuplicate: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    /** Phones whose post-start row reached delivered/read (live recovery counter). */
    recovered: { type: Number, default: 0 },
    /** Phones with submitted/sent post-start row, not yet delivered or terminal. */
    inFlight: { type: Number, default: 0 }
  },
  { _id: false }
);

/**
 * Admin-driven manual recovery batch for unresolved recipients of a single template.
 * Reuses safeSendWhatsApp (source: admin_manual). Does not change retry orchestrator.
 */
const whatsAppManualRecoveryJobSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
    default: 'queued',
    index: true
  },
  messageKind: {
    type: String,
    required: true,
    enum: ['slot_booked', 'pre4hr', 'meet', '30min'],
    index: true
  },
  /** UI filter window applied when computing candidates */
  fromAt: { type: Date, default: null },
  toAt: { type: Date, default: null },
  /** Lookback used to skip phones with recent delivered/read same kind */
  globalSuccessLookbackDays: { type: Number, default: 7 },
  candidatePhones: { type: [String], default: [] },
  createdBy: { type: String, trim: true, maxlength: 100, default: null },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  lastProgressAt: { type: Date, default: Date.now },
  cancelRequested: { type: Boolean, default: false },
  counters: { type: countersSchema, default: () => ({}) },
  errorSummary: { type: String, maxlength: 2000, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

whatsAppManualRecoveryJobSchema.index({ createdAt: -1 });
whatsAppManualRecoveryJobSchema.index({ messageKind: 1, createdAt: -1 });

whatsAppManualRecoveryJobSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('WhatsAppManualRecoveryJob', whatsAppManualRecoveryJobSchema);
