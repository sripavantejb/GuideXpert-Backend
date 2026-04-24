const mongoose = require('mongoose');

/**
 * Registration UTM links saved from the Admin → Analytics page only.
 * Separate from InfluencerLink (Influencer / UTM Tracking).
 */
const salesAnalyticsSavedUtmLinkSchema = new mongoose.Schema({
  influencerName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  platform: {
    type: String,
    required: true,
    trim: true,
    enum: ['Instagram', 'YouTube', 'Twitter', 'X', 'WhatsApp', 'Telegram', 'Facebook', 'LinkedIn'],
    default: 'Instagram',
  },
  campaign: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    default: 'guide_xperts',
  },
  utmLink: {
    type: String,
    required: true,
    trim: true,
  },
  cost: {
    type: Number,
    default: null,
    min: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { versionKey: false, collection: 'salesAnalyticsSavedUtmLinks' });

salesAnalyticsSavedUtmLinkSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SalesAnalyticsSavedUtmLink', salesAnalyticsSavedUtmLinkSchema);
