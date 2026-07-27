'use strict';

const mongoose = require('mongoose');

const webChatSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true, maxlength: 64 },
    flow: {
      type: String,
      enum: ['idle', 'college_predictor', 'rank_predictor', 'college_comparison'],
      default: 'idle',
      index: true,
    },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    phone: { type: String, trim: true, maxlength: 10, default: '' },
    fullName: { type: String, trim: true, maxlength: 120, default: '' },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    messageCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'webChatSessions',
  }
);

webChatSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

module.exports = mongoose.model('WebChatSession', webChatSessionSchema);
