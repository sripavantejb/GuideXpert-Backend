'use strict';

const mongoose = require('mongoose');
const { PRODUCT_LINES } = require('../constants/leadLifecycle');
const {
  ALERT_TYPES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
} = require('../constants/analyticsAlerts');

const analyticsAlertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ALERT_TYPES,
      index: true,
    },
    severity: {
      type: String,
      required: true,
      enum: ALERT_SEVERITIES,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ALERT_STATUSES,
      default: 'open',
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    productLine: {
      type: String,
      enum: [...PRODUCT_LINES, 'all', 'unknown'],
      default: 'all',
      index: true,
    },
    meta: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    dedupeKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 256,
    },
    triggeredAt: { type: Date, required: true, default: Date.now, index: true },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    resolvedAt: { type: Date, default: null },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'analyticsAlerts',
  }
);

analyticsAlertSchema.index({ status: 1, severity: 1, triggeredAt: -1 });
analyticsAlertSchema.index({ productLine: 1, type: 1, status: 1 });

module.exports = mongoose.model('AnalyticsAlert', analyticsAlertSchema);
