const mongoose = require('mongoose');
const { BOT_STATES } = require('../constants/chatbotStates');

const whatsAppBotStateSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      unique: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/],
      index: true,
    },
    state: {
      type: String,
      required: true,
      enum: BOT_STATES,
      default: 'greeting',
      index: true,
    },
    previousState: { type: String, trim: true, maxlength: 64, default: null },
    context: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    stateEnteredAt: { type: Date, default: Date.now },
    stateExpiresAt: { type: Date, default: null, index: true },
    version: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true }
);

whatsAppBotStateSchema.index({ state: 1, stateExpiresAt: 1 });

module.exports = mongoose.model('WhatsAppBotState', whatsAppBotStateSchema);
