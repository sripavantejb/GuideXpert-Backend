const mongoose = require('mongoose');

const BDA_NOTIFICATION_TYPES = ['lead_assigned', 'lead_reassigned_in', 'lead_reassigned_out'];

const bdaNotificationSchema = new mongoose.Schema({
  bdaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bda',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: BDA_NOTIFICATION_TYPES,
    required: true,
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IitCounsellingSubmission',
    required: true,
  },
  leadName: { type: String, trim: true, maxlength: 200, default: '' },
  leadPhone: { type: String, trim: true, maxlength: 20, default: '' },
  otherBdaName: { type: String, trim: true, maxlength: 100, default: '' },
  assignedByAdminName: { type: String, trim: true, maxlength: 100, default: '' },
  reason: { type: String, trim: true, maxlength: 500, default: '' },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, {
  versionKey: false,
});

bdaNotificationSchema.index({ bdaId: 1, createdAt: -1 });
bdaNotificationSchema.index({ bdaId: 1, readAt: 1 });

module.exports = mongoose.model('BdaNotification', bdaNotificationSchema);
module.exports.BDA_NOTIFICATION_TYPES = BDA_NOTIFICATION_TYPES;
