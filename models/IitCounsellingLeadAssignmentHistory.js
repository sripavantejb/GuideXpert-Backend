const mongoose = require('mongoose');

const iitCounsellingLeadAssignmentHistorySchema = new mongoose.Schema({
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
  previousBdaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bda',
    default: null,
  },
  previousBdaName: { type: String, trim: true, maxlength: 100 },
  newBdaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bda',
    required: true,
  },
  newBdaName: { type: String, trim: true, maxlength: 100 },
  assignedBy: {
    type: String,
    trim: true,
    maxlength: 100,
  },
  assignedByAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
  },
  assignedByAdminName: { type: String, trim: true, maxlength: 100 },
  assignedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  reason: {
    type: String,
    trim: true,
    maxlength: 500,
  },
}, {
  versionKey: false,
});

iitCounsellingLeadAssignmentHistorySchema.index({ leadId: 1, assignedAt: -1 });
iitCounsellingLeadAssignmentHistorySchema.index({ newBdaId: 1, assignedAt: -1 });

module.exports = mongoose.model(
  'IitCounsellingLeadAssignmentHistory',
  iitCounsellingLeadAssignmentHistorySchema
);
