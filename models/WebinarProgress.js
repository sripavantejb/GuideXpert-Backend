const mongoose = require('mongoose');

const moduleProgressSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['locked', 'unlocked', 'in_progress', 'completed'],
      default: 'locked',
    },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    watchedSeconds: { type: Number, default: 0 },
    maxWatchedSeconds: { type: Number, default: 0 },
    score: { type: Number, default: null },
    totalScore: { type: Number, default: null },
    completedAt: { type: Date, default: null },
    unlockedAt: { type: Date, default: null },
  },
  { _id: false }
);

const webinarProgressSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      match: /^\d{10}$/,
    },
    fullName: { type: String, default: '' },
    overallPercent: { type: Number, default: 0, min: 0, max: 100 },
    completedModules: { type: [String], default: [] },
    modules: {
      type: Map,
      of: moduleProgressSchema,
      default: () => new Map(),
    },
    lastActiveModule: { type: String, default: null },
    lastActivityAt: { type: Date, default: Date.now },
    certificateDownloadedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WebinarProgress', webinarProgressSchema);
