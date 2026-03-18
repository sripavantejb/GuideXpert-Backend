const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    certificateId: { type: String, required: true, unique: true, trim: true },
    fullName: { type: String, required: true, trim: true, maxlength: 200 },
    dateIssued: { type: String, required: true, trim: true, maxlength: 50 },
    // Keep undefined when not provided so sparse unique index does not store null duplicates.
    mobileNumber: { type: String, trim: true, default: undefined },
  },
  { timestamps: true }
);

schema.index({ certificateId: 1 });
schema.index({ mobileNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('WebinarCertificate', schema);
