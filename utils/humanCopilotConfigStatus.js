'use strict';

const {
  isHumanCopilotEnabled,
  isCopilotSuggestedRepliesEnabled,
  getCopilotHotLeadThreshold,
} = require('../services/chatbot/humanCopilot/humanCopilotFlags');
const { getKnowledgeAssistantConfigStatus } = require('./knowledgeAssistantConfigStatus');

function getHumanCopilotConfigStatus() {
  const enabled = isHumanCopilotEnabled();
  const suggestedReplies = isCopilotSuggestedRepliesEnabled();
  const knowledgeAssistant = getKnowledgeAssistantConfigStatus();
  const hotLeadThreshold = getCopilotHotLeadThreshold();
  const ready = enabled;
  const suggestedRepliesReady = !suggestedReplies || knowledgeAssistant.llmKeyPresent;

  return {
    enabled,
    suggestedReplies,
    ready,
    suggestedRepliesReady,
    hotLeadThreshold,
  };
}

async function getHumanCopilotHealthStatus() {
  const base = getHumanCopilotConfigStatus();
  let queueHealthy = true;
  let notificationsHealthy = true;

  if (base.enabled) {
    try {
      const WhatsAppAgentHandoff = require('../models/WhatsAppAgentHandoff');
      const count = await WhatsAppAgentHandoff.countDocuments({
        route: 'admin_pool',
        status: { $in: ['open', 'claimed'] },
      });
      queueHealthy = Number.isFinite(count);
    } catch {
      queueHealthy = false;
    }

    try {
      const { getNotifications } = require('../services/chatbot/humanCopilot/humanCopilotService');
      const items = await getNotifications();
      notificationsHealthy = Array.isArray(items);
    } catch {
      notificationsHealthy = false;
    }
  }

  return {
    ...base,
    queueHealthy,
    notificationsHealthy,
  };
}

function logHumanCopilotConfigStatus() {
  const status = getHumanCopilotConfigStatus();
  console.log({
    humanCopilotEnabled: process.env.CHATBOT_HUMAN_COPILOT_ENABLED,
    copilotSuggestedReplies: process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED,
    humanCopilotReady: status.ready,
  });
}

module.exports = {
  getHumanCopilotConfigStatus,
  getHumanCopilotHealthStatus,
  logHumanCopilotConfigStatus,
};
