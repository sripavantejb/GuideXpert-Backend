const mongoose = require('mongoose');
const {
  CURRENT_CLASS_OPTIONS,
  INTERESTED_BRANCH_OPTIONS,
  COLLEGE_BUDGET_OPTIONS,
  BIGGEST_CONCERN_OPTIONS,
  PREFERRED_LANGUAGE_OPTIONS,
  SESSION_ATTENDEE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  INDIAN_MOBILE_REGEX,
} = require('../constants/oneOnOneCounseling');
const { BOOKING_STATUS_OPTIONS } = require('../constants/guidanceBooking');

const schema = new mongoose.Schema(
  {
    studentName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    mobileNumber: { type: String, required: true, trim: true, match: INDIAN_MOBILE_REGEX },
    parentName: { type: String, trim: true, minlength: 2, maxlength: 100 },
    parentMobileNumber: { type: String, trim: true, match: INDIAN_MOBILE_REGEX },
    sessionAttendee: { type: String, enum: SESSION_ATTENDEE_OPTIONS },
    currentClass: { type: String, enum: CURRENT_CLASS_OPTIONS },
    city: { type: String, trim: true, minlength: 2, maxlength: 80 },
    entranceExamRank: { type: String, trim: true, maxlength: 120 },
    interestedBranch: { type: String, enum: INTERESTED_BRANCH_OPTIONS },
    collegeBudget: { type: String, enum: COLLEGE_BUDGET_OPTIONS },
    biggestConcern: { type: String, enum: BIGGEST_CONCERN_OPTIONS },
    preferredLanguage: { type: String, enum: PREFERRED_LANGUAGE_OPTIONS },
    preferredTimeSlot: { type: String, trim: true, maxlength: 200 },
    preferredTimeSlotDate: { type: String, trim: true, maxlength: 10 },
    additionalQuestions: { type: String, trim: true, maxlength: 2000, default: '' },
    formCompleted: { type: Boolean, default: false, index: true },
    currentStep: { type: Number, default: 0 },
    leadStatus: {
      type: String,
      enum: LEAD_STATUS_OPTIONS,
      default: 'New Lead',
    },
    utm_source: { type: String, trim: true, maxlength: 120 },
    utm_medium: { type: String, trim: true, maxlength: 120 },
    utm_campaign: { type: String, trim: true, maxlength: 120 },
    utm_content: { type: String, trim: true, maxlength: 120 },
    bookingConfirmed: { type: Boolean, default: false, index: true },
    bookingStatus: {
      type: String,
      enum: BOOKING_STATUS_OPTIONS,
      default: 'Not Booked',
      index: true,
    },
    selectedSlotId: { type: mongoose.Schema.Types.ObjectId, ref: 'GuidanceSlot', default: null },
    oneOnOneCounselorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OneOnOneCounselor',
      default: null,
    },
    parentAttendanceConfirmed: { type: Boolean, default: false },
    whatsappConsent: { type: Boolean, default: false },
    bookingConfirmedAt: { type: Date, default: null },
    attendanceStatus: { type: String, trim: true, maxlength: 40, default: '' },
    counselorRemarks: { type: String, trim: true, maxlength: 2000, default: '' },
    parentOccupation: { type: String, trim: true, maxlength: 120, default: '' },
    preferredColleges: {
      type: [{ type: String, trim: true, maxlength: 150 }],
      default: [],
      validate: {
        validator: (v) => Array.isArray(v) && v.length <= 3,
        message: 'At most 3 preferred colleges',
      },
    },
    natInitiated: { type: Boolean, default: false, index: true },
    natInterested: {
      type: String,
      enum: ['', 'yes', 'no', 'undecided'],
      default: '',
      trim: true,
    },
    natContactLater: { type: Boolean, default: false, index: true },
    natNotes: { type: String, trim: true, maxlength: 2000, default: '' },
    natFollowUpDate: { type: String, trim: true, maxlength: 10, default: '' },
    natChannel: { type: String, trim: true, maxlength: 80, default: '' },
    natCampaign: { type: String, trim: true, maxlength: 120, default: '' },
    natLanguage: { type: String, trim: true, maxlength: 40, default: '' },
    natCounsellorBy: { type: String, trim: true, maxlength: 80, default: '' },
    natCounsellorName: { type: String, trim: true, maxlength: 100, default: '' },
    natCbaName: { type: String, trim: true, maxlength: 100, default: '' },
    natBeforeSessionStage: { type: String, trim: true, maxlength: 80, default: '' },
    natPresentStage: { type: String, trim: true, maxlength: 80, default: '' },
    assignedBdaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bda',
      default: null,
      index: true,
    },
    assignedBdaName: { type: String, trim: true, maxlength: 100 },
    assignedAt: { type: Date, default: null },
    assignedBy: { type: String, trim: true, maxlength: 100 },
    assignedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    assignedByAdminName: { type: String, trim: true, maxlength: 100 },
  },
  { timestamps: true }
);

schema.index({ createdAt: -1 });
schema.index({ mobileNumber: 1 }, { unique: true, partialFilterExpression: { formCompleted: false } });
schema.index({ mobileNumber: 1 });
schema.index({ leadStatus: 1 });
schema.index({ currentClass: 1 });
schema.index({ preferredLanguage: 1 });
schema.index({ preferredTimeSlot: 1 });
schema.index({ preferredTimeSlotDate: 1 });
schema.index({ selectedSlotId: 1 });
schema.index({ oneOnOneCounselorId: 1 });
schema.index({ assignedBdaId: 1, assignedAt: -1 });
schema.index({ bookingConfirmedAt: -1 });

module.exports = mongoose.model('OneOnOneCounselingLead', schema);
