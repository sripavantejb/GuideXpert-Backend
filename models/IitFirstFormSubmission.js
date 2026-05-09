const mongoose = require('mongoose');

const iitFirstFormSubmissionSchema = new mongoose.Schema(
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
    /** Free-text answer to: Are you interested to learn more about AI? */
    interestedInAiLearning: {
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
  { collection: 'iitFirstFormSubmissions' }
);

iitFirstFormSubmissionSchema.index({ submittedAt: -1 });
iitFirstFormSubmissionSchema.index({ mobileNumber: 1, submittedAt: -1 });

module.exports = mongoose.model('IitFirstFormSubmission', iitFirstFormSubmissionSchema);
