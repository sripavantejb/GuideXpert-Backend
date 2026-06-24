const mongoose = require('mongoose');

const leadCallHistorySchema = new mongoose.Schema({
  leadType: {
    type: String,
    enum: ['iit_counselling', 'counsellor', 'one_on_one'],
    default: 'iit_counselling',
    index: true,
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IitCounsellingSubmission',
    required: true,
    index: true,
  },
  bdaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bda',
    default: null,
    index: true,
  },
  bdaName: { type: String, trim: true, maxlength: 100 },
  callStatus: { type: String, trim: true, maxlength: 64 },
  leadStatus: { type: String, trim: true, maxlength: 64 },
  demoStatus: { type: String, trim: true, maxlength: 64 },
  niatRegistrationStatus: { type: String, trim: true, maxlength: 64 },
  paymentStatus: { type: String, trim: true, maxlength: 64 },
  callbackNeeded: { type: Boolean, default: false },
  callbackDateTime: { type: Date, default: null },
  callbackNote: { type: String, trim: true, maxlength: 500 },
  remark: { type: String, trim: true, maxlength: 2000 },
  actorType: { type: String, enum: ['admin', 'bda'], default: 'bda' },
  actorName: { type: String, trim: true, maxlength: 100 },
  createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

leadCallHistorySchema.index({ leadId: 1, createdAt: -1 });

module.exports = mongoose.model('LeadCallHistory', leadCallHistorySchema);
