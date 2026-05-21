const mongoose = require('mongoose');
const {
  CALL_STATUS,
  LEAD_STATUS,
  DEMO_STATUS,
  NIAT_STATUS,
  PAYMENT_STATUS,
} = require('../constants/iitCounsellingLeadCrm');

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
  /** UTC instant for slot start (Asia/Kolkata), mirrors FormSubmission.step3Data.slotDate for ops cohorts */
  counsellingSlotInstantUtc: {
    type: Date,
    default: null,
    index: true,
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
      classStatus: {
        type: String,
        enum: [
          'Completed 12th/Intermediate 2nd Year',
          'Studying 12th/Intermediate 2nd Year',
          'Studying 11th/Intermediate 1st Year',
          'Degree Completed',
          'Degree Studying',
          'Engineering Completed',
          'Engineering Studying',
          'Diploma',
        ],
      },
      stream: { type: String, enum: ['MPC', 'BiPC', 'Commerce', 'Others'] },
      city: { type: String, trim: true },
      slotBooking: { type: String, enum: ['Wednesday 6PM', 'Saturday 6PM', 'Sunday 11AM'] },
      slotBookingDate: {
        type: String,
        trim: true,
        match: [/^\d{4}-\d{2}-\d{2}$/, 'slotBookingDate must be YYYY-MM-DD'],
      },
      top5Colleges: [{ type: String, trim: true }],
      submittedAt: { type: Date },
    },
    section2Data: {
      careerDecisionClarity: { type: String, enum: ['Very clear', 'Somewhat clear', 'Completely confused'] },
      collegeDecisionStakeholder: { type: String, enum: ['Self', 'Parents', 'Both'] },
      expectedBudget: { type: String, enum: ['<1L', '1-3L', '3-6L', '6L+'] },
      topCollegePriority: { type: String, enum: ['Placements', 'Brand', 'Fees', 'Skills', 'Abroad opportunities', 'All the above'] },
      // Keep in sync with formController IIT_ALLOWED_VALUES.preferredLanguage and IitCounsellingPage.jsx
      preferredLanguage: { type: String, enum: ['Telugu', 'Hindi'] },
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
  assignedBdaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bda',
    default: null,
    index: true,
  },
  assignedBdaName: { type: String, trim: true, maxlength: 100 },
  assignedAt: { type: Date, default: null },
  assignedBy: { type: String, trim: true, maxlength: 100 },
  callStatus: {
    type: String,
    enum: CALL_STATUS,
    default: 'not_called',
  },
  leadStatus: {
    type: String,
    enum: LEAD_STATUS,
  },
  demoStatus: {
    type: String,
    enum: DEMO_STATUS,
    default: 'not_scheduled',
  },
  niatStatus: {
    type: String,
    enum: NIAT_STATUS,
    default: 'not_registered',
  },
  paymentStatus: {
    type: String,
    enum: PAYMENT_STATUS,
    default: 'none',
  },
  callbackDate: { type: Date, default: null },
  lastRemark: { type: String, trim: true, maxlength: 2000 },
  lastActivityAt: { type: Date, default: null },
  crmUpdatedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'iitCounsellingSubmissions',
});

iitCounsellingSubmissionSchema.index({ phone: 1, createdAt: -1 });
iitCounsellingSubmissionSchema.index({ createdAt: -1 });
iitCounsellingSubmissionSchema.index({ assignedBdaId: 1, updatedAt: -1 });
iitCounsellingSubmissionSchema.index({ assignedBdaId: 1, lastActivityAt: -1 });
iitCounsellingSubmissionSchema.index({ assignedBdaId: 1, assignedAt: -1 });
module.exports = mongoose.model('IitCounsellingSubmission', iitCounsellingSubmissionSchema);
