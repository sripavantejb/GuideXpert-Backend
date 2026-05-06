const mongoose = require('mongoose');

/** Idempotency headers for WA retry promotions (attempt 2 = first retry slice, attempt 3 = second). */
const whatsAppRetryGroupSchema = new mongoose.Schema({
  messageKind: {
    type: String,
    required: true,
    enum: ['slot_booked', 'pre4hr', 'meet', '30min'],
    index: true
  },
  cronRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'MessagingCronRun', default: null, index: true },
  trigger: {
    type: String,
    enum: ['cron', 'save_step3', 'manual', 'retry_api'],
    default: 'cron',
    index: true
  },
  /** IST calendar date YYYY-MM-DD for rollup (optional). */
  istAnchorDate: { type: String, trim: true, maxlength: 10, default: null },
  attempt2BatchId: { type: mongoose.Schema.Types.ObjectId, default: null },
  attempt2TriggeredAt: { type: Date, default: null },
  attempt3BatchId: { type: mongoose.Schema.Types.ObjectId, default: null },
  attempt3TriggeredAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ['open', 'closed_no_more_retries', 'exhausted'],
    default: 'open',
    index: true
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

whatsAppRetryGroupSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

whatsAppRetryGroupSchema.index({ createdAt: -1 });

module.exports = mongoose.model('WhatsAppRetryGroup', whatsAppRetryGroupSchema);
