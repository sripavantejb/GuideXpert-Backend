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
    enum: ['Instagram', 'YouTube', 'Twitter', 'X', 'WhatsApp', 'Telegram', 'Facebook', 'LinkedIn'],
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
  linkTarget: {
    type: String,
    trim: true,
    enum: ['registration', 'iitCounselling'],
    default: 'registration'
  },
  cost: {
    type: Number,
    default: null,
    min: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

influencerLinkSchema.index({ createdAt: -1 });

const InfluencerLink = mongoose.model('InfluencerLink', influencerLinkSchema);
module.exports = InfluencerLink;
