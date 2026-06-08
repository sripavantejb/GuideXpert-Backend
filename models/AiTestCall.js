const mongoose = require('mongoose');

const AI_TEST_CALL_STATUSES = [
  'pending',
  'scheduled',
  'processing',
  'completed',
  'failed',
  'cancelled',
];

const aiTestCallSchema = new mongoose.Schema({
  personName: { type: String, trim: true, maxlength: 255, required: true },
  phone: {
    type: String,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits'],
    required: true,
    index: true,
  },
  callbackTime: { type: Date, required: true, index: true },
  notes: { type: String, trim: true, maxlength: 2000, default: null },
  status: {
    type: String,
    enum: AI_TEST_CALL_STATUSES,
    default: 'scheduled',
    index: true,
  },
  osviRequest: { type: mongoose.Schema.Types.Mixed, default: null },
  osviResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  lastError: { type: String, trim: true, maxlength: 1000, default: null },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
    index: true,
  },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'aiTestCalls',
});

module.exports = mongoose.model('AiTestCall', aiTestCallSchema);
module.exports.AI_TEST_CALL_STATUSES = AI_TEST_CALL_STATUSES;
