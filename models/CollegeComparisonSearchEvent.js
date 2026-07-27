'use strict';

const mongoose = require('mongoose');

const collegeComparisonSearchEventSchema = new mongoose.Schema(
  {
    phone: { type: String, trim: true, maxlength: 10, index: true, default: '' },
    fullName: { type: String, trim: true, maxlength: 120, default: '' },
    collegeAId: { type: String, trim: true, maxlength: 120, default: '' },
    collegeAName: { type: String, trim: true, maxlength: 200, required: true },
    collegeBId: { type: String, trim: true, maxlength: 120, default: '' },
    collegeBName: { type: String, trim: true, maxlength: 200, required: true },
    freeTextUsed: { type: Boolean, default: false },
    includeSummary: { type: Boolean, default: false },
    summaryGenerated: { type: Boolean, default: false },
    source: { type: String, enum: ['public', 'unknown'], default: 'public', index: true },
    winnersCountA: { type: Number, default: 0 },
    winnersCountB: { type: Number, default: 0 },
    resultSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    comparedAt: { type: Date, required: true, default: Date.now, index: true },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: 'collegeComparisonSearchEvents',
  }
);

collegeComparisonSearchEventSchema.index({ comparedAt: -1 });
collegeComparisonSearchEventSchema.index({ phone: 1, comparedAt: -1 });
collegeComparisonSearchEventSchema.index({ fullName: 1, comparedAt: -1 });

module.exports = mongoose.model(
  'CollegeComparisonSearchEvent',
  collegeComparisonSearchEventSchema
);
