const mongoose = require('mongoose');

const studentResourceSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 220,
      default: null,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
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
    gridFsFileId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    downloadCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

studentResourceSchema.index({ status: 1, publishedAt: -1, createdAt: -1 });
studentResourceSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } }
);

module.exports = mongoose.model('StudentResource', studentResourceSchema);
