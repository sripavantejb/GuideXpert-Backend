const mongoose = require('mongoose');
const {
  CURRENT_CLASS_OPTIONS,
  INTERESTED_BRANCH_OPTIONS,
  COLLEGE_BUDGET_OPTIONS,
  BIGGEST_CONCERN_OPTIONS,
  PREFERRED_LANGUAGE_OPTIONS,
  PREFERRED_TIME_SLOT_OPTIONS,
  LEAD_STATUS_OPTIONS,
  INDIAN_MOBILE_REGEX,
} = require('../constants/oneOnOneCounseling');

const schema = new mongoose.Schema(
  {
    studentName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    mobileNumber: { type: String, required: true, trim: true, match: INDIAN_MOBILE_REGEX },
    parentName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    parentMobileNumber: { type: String, required: true, trim: true, match: INDIAN_MOBILE_REGEX },
    currentClass: { type: String, required: true, enum: CURRENT_CLASS_OPTIONS },
    entranceExamRank: { type: String, required: true, trim: true, maxlength: 120 },
    interestedBranch: { type: String, required: true, enum: INTERESTED_BRANCH_OPTIONS },
    collegeBudget: { type: String, required: true, enum: COLLEGE_BUDGET_OPTIONS },
    biggestConcern: { type: String, required: true, enum: BIGGEST_CONCERN_OPTIONS },
    preferredLanguage: { type: String, required: true, enum: PREFERRED_LANGUAGE_OPTIONS },
    preferredTimeSlot: { type: String, required: true, enum: PREFERRED_TIME_SLOT_OPTIONS },
    additionalQuestions: { type: String, trim: true, maxlength: 2000, default: '' },
    leadStatus: {
      type: String,
      enum: LEAD_STATUS_OPTIONS,
      default: 'New Lead',
    },
    utm_source: { type: String, trim: true, maxlength: 120 },
    utm_medium: { type: String, trim: true, maxlength: 120 },
    utm_campaign: { type: String, trim: true, maxlength: 120 },
    utm_content: { type: String, trim: true, maxlength: 120 },
  },
  { timestamps: true }
);

schema.index({ createdAt: -1 });
schema.index({ mobileNumber: 1 });
schema.index({ leadStatus: 1 });
schema.index({ currentClass: 1 });
schema.index({ preferredLanguage: 1 });
schema.index({ preferredTimeSlot: 1 });

module.exports = mongoose.model('OneOnOneCounselingLead', schema);
