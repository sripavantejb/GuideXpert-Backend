const mongoose = require('mongoose');

const influencerLinkSchema = new mongoose.Schema({
  influencerName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  platform: {
    type: String,
    required: true,
    trim: true,
    enum: ['Instagram', 'YouTube', 'Twitter', 'WhatsApp'],
    default: 'Instagram'
  },
  campaign: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    default: 'guide_xperts'
  },
  utmLink: {
    type: String,
    required: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

influencerLinkSchema.index({ createdAt: -1 });

const InfluencerLink = mongoose.model('InfluencerLink', influencerLinkSchema);
module.exports = InfluencerLink;
