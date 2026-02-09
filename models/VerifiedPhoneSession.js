const mongoose = require('mongoose');

/**
 * Persists "phone verified by OTP" so assessment (and other flows) can accept submit
 * on serverless where in-memory otpStore is not shared across instances.
 * TTL: document is deleted 15 min after verifiedAt.
 */
const verifiedPhoneSessionSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits'],
    unique: true
  },
  verifiedAt: {
    type: Date,
    required: true,
    default: Date.now
  }
});

// TTL: remove document 15 min after verifiedAt (so submit window is 15 min)
verifiedPhoneSessionSchema.index({ verifiedAt: 1 }, { expireAfterSeconds: 15 * 60 });

module.exports = mongoose.model('VerifiedPhoneSession', verifiedPhoneSessionSchema);
