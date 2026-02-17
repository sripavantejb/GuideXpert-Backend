const mongoose = require('mongoose');

const studentMetaSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

studentMetaSchema.index({ studentId: 1, key: 1 }, { unique: true });

const StudentMeta = mongoose.model('StudentMeta', studentMetaSchema);
module.exports = StudentMeta;
