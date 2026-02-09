const mongoose = require('mongoose');

const assessmentSubmissionSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits'],
    unique: true
  },
  answers: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  score: {
    type: Number,
    required: true,
    min: 0
  },
  maxScore: {
    type: Number,
    required: true,
    min: 0
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

assessmentSubmissionSchema.index({ submittedAt: -1 });
assessmentSubmissionSchema.index({ phone: 1 });

assessmentSubmissionSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const AssessmentSubmission = mongoose.model('AssessmentSubmission', assessmentSubmissionSchema);

module.exports = AssessmentSubmission;
