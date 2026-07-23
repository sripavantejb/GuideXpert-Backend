const mongoose = require('mongoose');

/**
 * Logs student (and external) workspace logins.
 * Phone is required; name/source are optional enrichment for admin views.
 */
const websiteLoginSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits'],
  },
  fullName: {
    type: String,
    trim: true,
    default: '',
    maxlength: 200,
  },
  source: {
    type: String,
    trim: true,
    default: 'student_workspace',
    maxlength: 80,
  },
  loggedInAt: {
    type: Date,
    default: Date.now,
  },
});

websiteLoginSchema.index({ phone: 1, loggedInAt: -1 });
websiteLoginSchema.index({ loggedInAt: -1 });
websiteLoginSchema.index({ source: 1, loggedInAt: -1 });

module.exports = mongoose.model('WebsiteLogin', websiteLoginSchema);
