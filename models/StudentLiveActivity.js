const mongoose = require('mongoose');

/**
 * Public social-proof feed for student workspace hero.
 * Stores only display-safe fields (no phone, no scores/results).
 */
const studentLiveActivitySchema = new mongoose.Schema(
  {
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    toolLabel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    toolKey: {
      type: String,
      trim: true,
      maxlength: 64,
      default: '',
    },
    /** used | booked — drives toast copy */
    action: {
      type: String,
      enum: ['used', 'booked'],
      default: 'used',
    },
  },
  { timestamps: true }
);

studentLiveActivitySchema.index({ createdAt: -1 });

module.exports = mongoose.model('StudentLiveActivity', studentLiveActivitySchema);
