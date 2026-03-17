const mongoose = require('mongoose');

const assessmentSubmission4Schema = new mongoose.Schema({
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

assessmentSubmission4Schema.index({ submittedAt: -1 });
assessmentSubmission4Schema.index({ phone: 1 });

assessmentSubmission4Schema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const AssessmentSubmission4 = mongoose.model('AssessmentSubmission4', assessmentSubmission4Schema);

module.exports = AssessmentSubmission4;
