const mongoose = require('mongoose');

/**
 * Logs phone numbers of users who log in on an external website.
 * Only phone is stored; no OTP or other PII.
 */
const websiteLoginSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits']
  },
  loggedInAt: {
    type: Date,
    default: Date.now
  }
});

websiteLoginSchema.index({ phone: 1, loggedInAt: -1 });

module.exports = mongoose.model('WebsiteLogin', websiteLoginSchema);
