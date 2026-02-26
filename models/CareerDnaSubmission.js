const mongoose = require('mongoose');

const careerDnaSubmissionSchema = new mongoose.Schema(
  {
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
    },
    email: { type: String, trim: true, lowercase: true, default: '' },
    school: { type: String, trim: true, maxlength: 200, default: '' },
    class: { type: String, trim: true, maxlength: 50, default: '' },
    counsellorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Counsellor',
      default: null,
      index: true,
    },
    utm_source: { type: String, trim: true, default: '' },
    utm_medium: { type: String, trim: true, default: '' },
    utm_campaign: { type: String, trim: true, default: '' },
    utm_content: { type: String, trim: true, default: '' },
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },
    score: { type: Number, required: true, min: 0 },
    maxScore: { type: Number, required: true, min: 0 },
    submittedAt: { type: Date, default: Date.now },
    scoreBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
    primaryType: { type: String, trim: true, default: '' },
    secondaryType: { type: String, trim: true, default: '' },
    resultTitle: { type: String, trim: true, default: '' },
    suggestedCareerPaths: { type: [String], default: [] },
    suggestedCourses: { type: [String], default: [] },
  },
  { timestamps: true }
);

careerDnaSubmissionSchema.index({ submittedAt: -1 });
careerDnaSubmissionSchema.index({ phone: 1 });
careerDnaSubmissionSchema.index({ counsellorId: 1, submittedAt: -1 });

const CareerDnaSubmission = mongoose.model('CareerDnaSubmission', careerDnaSubmissionSchema);
module.exports = CareerDnaSubmission;
