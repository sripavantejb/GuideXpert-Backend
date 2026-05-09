const mongoose = require('mongoose');

const iitSecondFormSubmissionSchema = new mongoose.Schema(
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
      match: [/^\d{10}$/, 'Mobile number must be 10 digits'],
    },
    /** Answer to: Which Career Guidance Support Do You Need? */
    careerGuidanceSupport: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'iitSecondFormSubmissions' }
);

iitSecondFormSubmissionSchema.index({ submittedAt: -1 });
iitSecondFormSubmissionSchema.index({ mobileNumber: 1, submittedAt: -1 });

module.exports = mongoose.model('IitSecondFormSubmission', iitSecondFormSubmissionSchema);
