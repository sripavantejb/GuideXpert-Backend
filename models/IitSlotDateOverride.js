const mongoose = require('mongoose');

const iitSlotDateOverrideSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
  },
  slotId: {
    type: String,
    required: true,
    trim: true,
  },
  enabled: {
    type: Boolean,
    required: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

iitSlotDateOverrideSchema.index({ date: 1, slotId: 1 }, { unique: true });

module.exports = mongoose.model('IitSlotDateOverride', iitSlotDateOverrideSchema);
