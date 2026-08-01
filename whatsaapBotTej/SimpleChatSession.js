/**
 * whatsaapBotTej — per-phone conversation session for the simple WhatsApp AI bot.
 * One document per phone number: rolling message history + processed message ids
 * (Gupshup retries webhooks, so we dedupe by provider message id).
 */
const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const simpleChatSessionSchema = new mongoose.Schema(
  {
    phone10: { type: String, required: true, unique: true },
    messages: { type: [chatMessageSchema], default: [] },
    processedMessageIds: { type: [String], default: [] },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'simple_chat_sessions_tej' }
);

module.exports =
  mongoose.models.SimpleChatSession ||
  mongoose.model('SimpleChatSession', simpleChatSessionSchema);
