'use strict';

const mongoose = require('mongoose');

const collegePredictorSearchEventSchema = new mongoose.Schema(
  {
    exam: { type: String, trim: true, maxlength: 64, index: true },
    source: {
      type: String,
      enum: ['counsellor', 'public', 'unknown'],
      default: 'unknown',
      index: true,
    },
    branchCodes: { type: [String], default: [] },
    districts: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    collegeNames: { type: [String], default: [] },
    resultCount: { type: Number, default: 0 },
    searchedAt: { type: Date, required: true, default: Date.now, index: true },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: 'collegePredictorSearchEvents',
  }
);

collegePredictorSearchEventSchema.index({ searchedAt: -1 });
collegePredictorSearchEventSchema.index({ exam: 1, searchedAt: -1 });

module.exports = mongoose.model('CollegePredictorSearchEvent', collegePredictorSearchEventSchema);
