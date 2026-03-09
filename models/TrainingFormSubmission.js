const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    mobileNumber: { type: String, required: true, trim: true, match: /^\d{10}$/ },
    email: { type: String, required: true, trim: true, lowercase: true },
    occupation: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    sessionRating: { type: Number, required: true, min: 1, max: 5 },
    suggestions: { type: String, trim: true, maxlength: 2000, default: '' },
  },
  { timestamps: true }
);

schema.index({ createdAt: -1 });
schema.index({ mobileNumber: 1 });

module.exports = mongoose.model('TrainingFormSubmission', schema);
