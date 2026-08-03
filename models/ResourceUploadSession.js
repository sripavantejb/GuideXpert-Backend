const mongoose = require('mongoose');

const resourceUploadSessionSchema = new mongoose.Schema(
  {
    uploadId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 260,
    },
    fileSize: {
      type: Number,
      required: true,
      min: 1,
    },
    mimeType: {
      type: String,
      trim: true,
      default: 'application/pdf',
    },
    totalChunks: {
      type: Number,
      required: true,
      min: 1,
    },
    receivedChunks: {
      type: Number,
      default: 0,
      min: 0,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    createdBy: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'complete', 'failed'],
      default: 'pending',
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

resourceUploadSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ResourceUploadSession', resourceUploadSessionSchema);
