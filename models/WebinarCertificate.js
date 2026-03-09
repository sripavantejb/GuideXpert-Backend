const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    certificateId: { type: String, required: true, unique: true, trim: true },
    fullName: { type: String, required: true, trim: true, maxlength: 200 },
    dateIssued: { type: String, required: true, trim: true, maxlength: 50 },
    mobileNumber: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

schema.index({ certificateId: 1 });
schema.index({ mobileNumber: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('WebinarCertificate', schema);
