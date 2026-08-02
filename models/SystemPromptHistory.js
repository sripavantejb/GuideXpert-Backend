'use strict';

const mongoose = require('mongoose');

const systemPromptHistorySchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    hash: { type: String, required: true, trim: true },
    bytes: { type: Number, required: true, min: 0 },
    updatedAt: { type: Date, required: true },
    updatedByEmail: { type: String, default: null, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

systemPromptHistorySchema.index({ updatedAt: -1 });

module.exports = mongoose.model('SystemPromptHistory', systemPromptHistorySchema);
