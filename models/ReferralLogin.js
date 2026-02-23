const mongoose = require('mongoose');

/**
 * Referral login: stores phone after successful OTP verification.
 * Same phone can have multiple records (each login = one record).
 */
const referralLoginSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits']
  },
  verifiedAt: {
    type: Date,
    default: Date.now
  }
});

referralLoginSchema.index({ phone: 1, verifiedAt: -1 });

module.exports = mongoose.model('ReferralLogin', referralLoginSchema);
