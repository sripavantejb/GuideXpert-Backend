'use strict';

const mongoose = require('mongoose');
const { LIFECYCLE_STAGES, PRODUCT_LINES, CONFIDENCE_LEVELS } = require('../constants/leadLifecycle');

const leadLifecycleEventSchema = new mongoose.Schema(
  {
    dedupeKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 256,
    },
    phone10: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'phone10 must be 10 digits'],
      index: true,
    },
    productLine: {
      type: String,
      required: true,
      enum: PRODUCT_LINES,
      index: true,
    },
    stage: {
      type: String,
      required: true,
      enum: LIFECYCLE_STAGES,
      index: true,
    },
    previousStage: {
      type: String,
      enum: [...LIFECYCLE_STAGES, null],
      default: null,
    },
    sourceCollection: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    transitionAt: {
      type: Date,
      required: true,
      index: true,
    },
    meta: {
      inferred: { type: Boolean, default: false },
      proxyField: { type: String, trim: true, maxlength: 128, default: null },
      confidence: {
        type: String,
        enum: CONFIDENCE_LEVELS,
        default: 'medium',
      },
      utm_source: { type: String, trim: true, maxlength: 120 },
      assignedBdaId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Bda',
        default: null,
      },
      leadScore: { type: Number, min: 0, max: 100, default: null },
      leadStage: { type: String, trim: true, maxlength: 32, default: null },
      note: { type: String, trim: true, maxlength: 512, default: null },
    },
    backfilledAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: 'leadLifecycleEvents',
  }
);

leadLifecycleEventSchema.index({ phone10: 1, productLine: 1, transitionAt: 1 });
leadLifecycleEventSchema.index({ productLine: 1, stage: 1, transitionAt: -1 });
leadLifecycleEventSchema.index({ stage: 1, transitionAt: -1 });
leadLifecycleEventSchema.index({ productLine: 1, stage: 1, phone10: 1 });
leadLifecycleEventSchema.index({ productLine: 1, phone10: 1 });

module.exports = mongoose.model('LeadLifecycleEvent', leadLifecycleEventSchema);
