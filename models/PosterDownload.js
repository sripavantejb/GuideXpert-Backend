const mongoose = require('mongoose');
const { POSTER_KEYS, FORMATS } = require('../utils/posterDownloadConstants');
const IDENTITY_METHODS = ['jwt', 'phone_match', 'anonymous'];
const ROUTE_CONTEXTS = ['public', 'portal'];

const posterDownloadSchema = new mongoose.Schema(
  {
    counsellorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Counsellor',
      default: null,
    },
    posterKey: {
      type: String,
      required: true,
      enum: POSTER_KEYS,
    },
    format: {
      type: String,
      required: true,
      enum: FORMATS,
    },
    identityMethod: {
      type: String,
      required: true,
      enum: IDENTITY_METHODS,
    },
    routeContext: {
      type: String,
      enum: ROUTE_CONTEXTS,
    },
    displayNameSnapshot: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },
    mobileSnapshot: {
      type: String,
      trim: true,
      maxlength: 10,
      default: '',
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: 512,
      default: '',
    },
    downloadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

posterDownloadSchema.index({ downloadedAt: -1 });
posterDownloadSchema.index({ posterKey: 1, downloadedAt: -1 });
posterDownloadSchema.index({ counsellorId: 1, downloadedAt: -1 });

const PosterDownload = mongoose.model('PosterDownload', posterDownloadSchema);

module.exports = PosterDownload;
module.exports.POSTER_KEYS = POSTER_KEYS;
module.exports.FORMATS = FORMATS;
