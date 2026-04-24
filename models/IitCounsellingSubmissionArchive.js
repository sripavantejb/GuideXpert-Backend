const mongoose = require('mongoose');

const iitCounsellingSubmissionArchiveSchema = new mongoose.Schema({
  sourceCollection: {
    type: String,
    default: 'formsubmissions',
    trim: true,
  },
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true,
    index: true,
  },
  migratedToIitSubmissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IitCounsellingSubmission',
    index: true,
  },
  migratedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  snapshot: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
}, {
  versionKey: false,
  collection: 'iitCounsellingSubmissionArchive',
});

module.exports = mongoose.model('IitCounsellingSubmissionArchive', iitCounsellingSubmissionArchiveSchema);
