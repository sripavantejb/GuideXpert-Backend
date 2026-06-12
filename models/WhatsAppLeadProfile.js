'use strict';

const mongoose = require('mongoose');
const { ASSISTANT_TYPES } = require('../services/chatbot/leadProfile/leadProfileConstants');

const whatsAppLeadProfileSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      match: [/^\d{10}$/, 'Phone must be 10 digits'],
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    branchInterest: {
      type: String,
      trim: true,
      maxlength: 512,
      default: null,
    },
    collegeInterest: {
      type: String,
      trim: true,
      maxlength: 512,
      default: null,
    },
    exam: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },
    languagePreference: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },
    priceSensitive: {
      type: Boolean,
      default: false,
    },
    demoInterested: {
      type: Boolean,
      default: false,
    },
    handoffRequested: {
      type: Boolean,
      default: false,
    },
    assistantTypesUsed: {
      type: [{ type: String, enum: ASSISTANT_TYPES }],
      default: [],
    },
    eventCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    firstInteractionAt: {
      type: Date,
      default: null,
    },
    lastInteractionAt: {
      type: Date,
      default: null,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: false }
);

whatsAppLeadProfileSchema.index({ lastInteractionAt: -1 });

module.exports = mongoose.model('WhatsAppLeadProfile', whatsAppLeadProfileSchema);
