const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    counselorName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    studentName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    registeredForNat: { type: Boolean, required: true },
    sessionSummary: { type: String, required: true, trim: true, minlength: 5, maxlength: 5000 },
    sessionRecordingLink: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

schema.index({ createdAt: -1 });
schema.index({ counselorName: 1 });
schema.index({ studentName: 1 });

module.exports = mongoose.model('IitainSessionFeedbackSubmission', schema);
