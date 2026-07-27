'use strict';

const mongoose = require('mongoose');

const collegeComparisonProfileSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true, unique: true, maxlength: 180 },
    name: { type: String, trim: true, required: true, maxlength: 200 },
    aliases: { type: [String], default: [] },
    shortName: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    ownership: { type: String, trim: true, default: 'Private' },
    approvals: { type: [String], default: [] },
    rankingLabel: { type: String, trim: true, default: 'Not available' },
    rankingScore: { type: Number, default: 50 },
    averagePackageLabel: { type: String, trim: true, default: 'Not available' },
    averagePackageValue: { type: Number, default: null },
    placementRateLabel: { type: String, trim: true, default: 'Not available' },
    placementRateValue: { type: Number, default: null },
    annualFeesLabel: { type: String, trim: true, default: 'Not available' },
    annualFeesValue: { type: Number, default: null },
    roiLabel: { type: String, trim: true, default: 'Not available' },
    roiScore: { type: Number, default: 50 },
    campusSizeLabel: { type: String, trim: true, default: 'Not available' },
    campusSizeScore: { type: Number, default: 50 },
    branchCount: { type: Number, default: 0 },
    flagshipBranches: { type: [String], default: [] },
    highlights: { type: [String], default: [] },
    source: { type: String, enum: ['catalog', 'ai_free_text'], default: 'ai_free_text' },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: 'collegeComparisonProfiles',
  }
);

module.exports = mongoose.model('CollegeComparisonProfile', collegeComparisonProfileSchema);
