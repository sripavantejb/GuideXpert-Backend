'use strict';

const mongoose = require('mongoose');
const { PRODUCT_LINES } = require('../constants/chatbotStates');
const { ASSISTANT_TYPES } = require('../services/chatbot/leadEventExtraction/leadEventExtractionConstants');
const { LEAD_EVENT_TYPES } = require('../services/chatbot/leadEventExtraction/leadEventExtractionConstants');

const leadEventItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: LEAD_EVENT_TYPES,
    },
    value: {
      type: String,
      required: true,
      trim: true,
      maxlength: 512,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    evidence: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1024,
    },
  },
  { _id: false }
);

const whatsAppLeadEventSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'Phone must be 10 digits'],
      index: true,
    },
    inboundMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppInboundMessage',
      required: true,
      unique: true,
    },
    outboundMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppOutboundMessage',
      default: null,
    },
    intent: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },
    intentReason: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },
    productLine: {
      type: String,
      enum: PRODUCT_LINES,
      default: 'unknown',
    },
    events: {
      type: [leadEventItemSchema],
      default: [],
    },
    assistantType: {
      type: String,
      enum: ASSISTANT_TYPES,
      default: 'unknown',
    },
    extractionModel: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },
    rawJson: {
      type: String,
      maxlength: 8000,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: false }
);

whatsAppLeadEventSchema.index({ phone: 1, createdAt: -1 });
whatsAppLeadEventSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('WhatsAppLeadEvent', whatsAppLeadEventSchema);
