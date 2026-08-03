const mongoose = require('mongoose');

const resourceUploadChunkSchema = new mongoose.Schema(
  {
    uploadId: {
      type: String,
      required: true,
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    data: {
      type: Buffer,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

resourceUploadChunkSchema.index({ uploadId: 1, chunkIndex: 1 }, { unique: true });
resourceUploadChunkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ResourceUploadChunk', resourceUploadChunkSchema);
