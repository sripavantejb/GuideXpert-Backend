const mongoose = require('mongoose');

const iitCounsellingSubmissionSchema = new mongoose.Schema({
  submissionType: {
    type: String,
    enum: ['iitCounselling'],
    default: 'iitCounselling',
    index: true,
  },
  legacyFormSubmissionId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true,
    unique: true,
    sparse: true,
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits'],
    index: true,
  },
  occupation: {
    type: String,
    trim: true,
    maxlength: 200,
    default: 'Student',
  },
  currentStep: {
    type: Number,
    default: 1,
    min: 1,
    max: 3,
  },
  applicationStatus: {
    type: String,
    enum: ['in_progress', 'completed'],
    default: 'in_progress',
  },
  isCompleted: {
    type: Boolean,
    default: false,
  },
  iitCounselling: {
    currentStep: {
      type: Number,
      default: 1,
      min: 1,
      max: 3,
    },
    isCompleted: {
      type: Boolean,
      default: false,
    },
    section1Data: {
      fullName: { type: String, trim: true },
      mobileNumber: { type: String, trim: true },
      studentOrParent: { type: String, enum: ['Student', 'Parent'] },
      classStatus: { type: String, enum: ['12th Appearing', '12th Passed'] },
      stream: { type: String, enum: ['MPC', 'BiPC', 'Commerce', 'Others'] },
      city: { type: String, trim: true },
      slotBooking: { type: String, enum: ['Yes', 'No', 'Need another time'] },
      top5Colleges: [{ type: String, trim: true }],
      submittedAt: { type: Date },
    },
    section2Data: {
      careerDecisionClarity: { type: String, enum: ['Very clear', 'Somewhat clear', 'Completely confused'] },
      collegeDecisionStakeholder: { type: String, enum: ['Self', 'Parents', 'Both'] },
      expectedBudget: { type: String, enum: ['<1L', '1-3L', '3-6L', '6L+'] },
      topCollegePriority: { type: String, enum: ['Placements', 'Brand', 'Fees', 'Skills', 'Abroad opportunities', 'All the above'] },
      submittedAt: { type: Date },
    },
    section3Data: {
      helpNeeded: { type: String, enum: ['Scholarship Test', 'Career Counseling with IITian', 'How to choose the right college', 'Not sure'] },
      wantsOneToOneSession: { type: String, enum: ['Yes', 'Maybe', 'No'] },
      biggestConfusion: { type: String, enum: ['Course', 'College', 'Placements', 'Parent pressure', 'Not sure'] },
      submittedAt: { type: Date },
    },
    lastUpdatedAt: { type: Date },
  },
  utm_source: { type: String, trim: true },
  utm_medium: { type: String, trim: true },
  utm_campaign: { type: String, trim: true },
  utm_content: { type: String, trim: true },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'iitCounsellingSubmissions',
});

iitCounsellingSubmissionSchema.index({ phone: 1, createdAt: -1 });
iitCounsellingSubmissionSchema.index({ createdAt: -1 });
iitCounsellingSubmissionSchema.index({ currentStep: 1, isCompleted: 1, createdAt: -1 });

module.exports = mongoose.model('IitCounsellingSubmission', iitCounsellingSubmissionSchema);
