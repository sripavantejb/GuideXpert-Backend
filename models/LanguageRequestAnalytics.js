const mongoose = require('mongoose');
const { SUPPORTED_LANGUAGES } = require('../constants/languageConstants');

const languageRequestAnalyticsSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, trim: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    language: { type: String, required: true, enum: SUPPORTED_LANGUAGES },
    totalRequests: { type: Number, default: 0, min: 0 },
    translatedRequests: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

languageRequestAnalyticsSchema.index({ date: 1, language: 1 }, { unique: true });

module.exports = mongoose.model('LanguageRequestAnalytics', languageRequestAnalyticsSchema);
