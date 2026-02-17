const mongoose = require('mongoose');

const slotConfigSchema = new mongoose.Schema({
  slotId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  enabled: {
    type: Boolean,
    default: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SlotConfig', slotConfigSchema);
