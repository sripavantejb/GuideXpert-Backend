const mongoose = require('mongoose');

const natCampaignSubmissionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    mobileNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      match: [/^\d{10}$/, 'Mobile number must be 10 digits'],
    },
    collegePreferences: {
      type: [String],
      required: true,
      enum: ['zenith-school-of-ai', 'niat', 'scaler', 'newton', 'others'],
    },
    collegePreferenceOther: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
    otpVerified: {
      type: Boolean,
      default: true,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'natCampaignSubmissions' }
);

natCampaignSubmissionSchema.index({ submittedAt: -1 });
natCampaignSubmissionSchema.index({ mobileNumber: 1, submittedAt: -1 });

module.exports = mongoose.model('NatCampaignSubmission', natCampaignSubmissionSchema);
