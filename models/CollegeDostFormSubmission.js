const mongoose = require('mongoose');

const collegeDostFormSubmissionSchema = new mongoose.Schema(
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
    interestedInNewColleges: {
      type: String,
      required: true,
      enum: ['yes', 'no'],
    },
    newAgeCollegePreference: {
      type: String,
      enum: [
        'zenith-school-of-ai',
        'niat',
        'scaler',
        'newton-school-of-technology',
      ],
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
  { collection: 'collegeDostFormSubmissions' }
);

collegeDostFormSubmissionSchema.index({ submittedAt: -1 });
collegeDostFormSubmissionSchema.index({ mobileNumber: 1, submittedAt: -1 });

module.exports = mongoose.model('CollegeDostFormSubmission', collegeDostFormSubmissionSchema);
