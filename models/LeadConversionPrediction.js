'use strict';

const mongoose = require('mongoose');

const leadConversionPredictionSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'phone must be 10 digits'],
      unique: true,
      index: true,
    },
    rulesVersion: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    computedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: 'leadConversionPredictions',
  }
);

leadConversionPredictionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('LeadConversionPrediction', leadConversionPredictionSchema);
