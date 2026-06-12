'use strict';

const mongoose = require('mongoose');

const LEAD_STAGES = ['cold', 'warm', 'hot'];

const whatsAppLeadScoreSchema = new mongoose.Schema(
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
    leadScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0,
    },
    leadStage: {
      type: String,
      enum: LEAD_STAGES,
      required: true,
      default: 'cold',
      index: true,
    },
    scoreReasons: {
      type: [String],
      default: [],
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.5,
    },
    firstScoredAt: {
      type: Date,
      default: null,
    },
    lastScoredAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: false }
);

whatsAppLeadScoreSchema.index({ leadScore: -1 });

module.exports = mongoose.model('WhatsAppLeadScore', whatsAppLeadScoreSchema);
