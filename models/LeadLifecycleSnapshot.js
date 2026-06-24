'use strict';

const mongoose = require('mongoose');
const { LIFECYCLE_STAGES, PRODUCT_LINES } = require('../constants/leadLifecycle');

const stageCountSchema = new mongoose.Schema(
  {
    lead: { type: Number, default: 0 },
    qualified: { type: Number, default: 0 },
    interested: { type: Number, default: 0 },
    booked: { type: Number, default: 0 },
    attended: { type: Number, default: 0 },
    admission: { type: Number, default: 0 },
  },
  { _id: false }
);

const transitionSchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    sampleSize: { type: Number, default: 0 },
    medianMs: { type: Number, default: null },
  },
  { _id: false }
);

const stageRowSchema = new mongoose.Schema(
  {
    stage: { type: String, required: true },
    count: { type: Number, default: 0 },
    rateFromLeadPct: { type: Number, default: 0 },
    dropOffFromPreviousPct: { type: Number, default: 0 },
  },
  { _id: false }
);

const productLineBreakdownSchema = new mongoose.Schema(
  {
    productLine: { type: String, required: true },
    cohortSize: { type: Number, default: 0 },
    stageCounts: { type: stageCountSchema, default: () => ({}) },
    stages: { type: [stageRowSchema], default: [] },
  },
  { _id: false }
);

const leadLifecycleSnapshotSchema = new mongoose.Schema(
  {
    rangeKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
      index: true,
    },
    productLine: {
      type: String,
      required: true,
      enum: [...PRODUCT_LINES, 'all'],
      index: true,
    },
    fromDate: { type: String, default: null },
    toDate: { type: String, default: null },
    cohortSize: { type: Number, default: 0 },
    stageCounts: { type: stageCountSchema, default: () => ({}) },
    stages: { type: [stageRowSchema], default: [] },
    transitions: { type: [transitionSchema], default: [] },
    byProductLine: { type: [productLineBreakdownSchema], default: [] },
    countingMethod: {
      type: String,
      default: 'distinct_phone',
    },
    eventCountAtGeneration: { type: Number, default: 0 },
    buildDurationMs: { type: Number, default: 0 },
    generatedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: 'leadLifecycleSnapshots',
  }
);

leadLifecycleSnapshotSchema.index({ rangeKey: 1, productLine: 1 }, { unique: true });

module.exports = mongoose.model('LeadLifecycleSnapshot', leadLifecycleSnapshotSchema);
