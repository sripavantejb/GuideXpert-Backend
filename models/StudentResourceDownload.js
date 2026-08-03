const mongoose = require('mongoose');

const studentResourceDownloadSchema = new mongoose.Schema(
  {
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StudentResource',
      required: true,
      index: true,
    },
    resourceTitle: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'Phone must be 10 digits'],
      index: true,
    },
    downloadedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    otpVerifiedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

studentResourceDownloadSchema.index({ resourceId: 1, downloadedAt: -1 });

module.exports = mongoose.model('StudentResourceDownload', studentResourceDownloadSchema);
