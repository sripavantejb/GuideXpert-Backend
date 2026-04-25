const mongoose = require('mongoose');

const dashboardLeadBucketValues = ['0-10', '11-20', '21-30', '30+'];
const contactedLeadBucketValues = ['All', 'Most', 'Few', 'None'];
const natLeadBucketValues = ['0', '1-5', '5-10', '10+'];
const stuckStageValues = ['First call', 'Follow-up', 'Closing for NAT'];
const supportNeedValues = [
  'Help with first call script',
  'Help with follow-up strategy',
  'Help with NAT template',
  'Objection handling support',
  'Deal closing support',
  'Demo counselling session',
  'Other',
];

const counsellorSupportRequestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    registeredMobileNumber: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'Mobile number must be 10 digits'],
      index: true,
    },
    dashboardLeadBucket: { type: String, required: true, enum: dashboardLeadBucketValues },
    contactedLeadBucket: { type: String, required: true, enum: contactedLeadBucketValues },
    natLeadBucket: { type: String, required: true, enum: natLeadBucketValues },
    stuckStage: { type: String, required: true, enum: stuckStageValues },
    supportNeeded: { type: String, required: true, enum: supportNeedValues },
    otherQuestions: { type: String, trim: true, maxlength: 3000, default: '' },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'counsellorSupportRequests',
  }
);

counsellorSupportRequestSchema.index({ createdAt: -1 });

module.exports = {
  CounsellorSupportRequest: mongoose.model('CounsellorSupportRequest', counsellorSupportRequestSchema),
  COUNSELLOR_SUPPORT_ENUMS: {
    dashboardLeadBucketValues,
    contactedLeadBucketValues,
    natLeadBucketValues,
    stuckStageValues,
    supportNeedValues,
  },
};
