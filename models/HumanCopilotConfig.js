'use strict';

const mongoose = require('mongoose');
const { COPILOT_ROUTING_MODES } = require('../services/chatbot/humanCopilot/humanCopilotAgentConstants');

const CONFIG_ID = 'default';

const humanCopilotConfigSchema = new mongoose.Schema(
  {
    _id: { type: String, default: CONFIG_ID },
    routingMode: {
      type: String,
      enum: COPILOT_ROUTING_MODES,
      default: 'manual',
    },
    roundRobinCursor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    specialtyRules: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        iit: ['iit'],
        scholarship: ['scholarship'],
      }),
    },
    routingAnalytics: {
      assignmentCounts: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
      overloadEvents: { type: Number, default: 0 },
      specialistUsage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
      routingReasons: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
      workloadSnapshots: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

humanCopilotConfigSchema.pre('save', function () {
  this.updatedAt = new Date();
});

async function getOrCreateConfig() {
  let doc = await HumanCopilotConfig.findById(CONFIG_ID).lean();
  if (!doc) {
    doc = (
      await HumanCopilotConfig.create({
        _id: CONFIG_ID,
        routingMode: 'manual',
      })
    ).toObject();
  }
  return doc;
}

const HumanCopilotConfig = mongoose.model('HumanCopilotConfig', humanCopilotConfigSchema);

module.exports = HumanCopilotConfig;
module.exports.CONFIG_ID = CONFIG_ID;
module.exports.getOrCreateConfig = getOrCreateConfig;
