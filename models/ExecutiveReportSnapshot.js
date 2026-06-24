'use strict';

const mongoose = require('mongoose');

const DELIVERY_STATUSES = Object.freeze(['pending', 'generated', 'delivered', 'failed']);

const executiveReportSnapshotSchema = new mongoose.Schema(
  {
    reportDate: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'reportDate must be YYYY-MM-DD'],
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    deliveryStatus: {
      type: String,
      enum: DELIVERY_STATUSES,
      default: 'generated',
      index: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: 'executiveReportSnapshots',
  }
);

executiveReportSnapshotSchema.index({ reportDate: 1 }, { unique: true });
executiveReportSnapshotSchema.index({ generatedAt: -1 });

module.exports = mongoose.model('ExecutiveReportSnapshot', executiveReportSnapshotSchema);
module.exports.DELIVERY_STATUSES = DELIVERY_STATUSES;
