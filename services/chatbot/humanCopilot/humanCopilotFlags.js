'use strict';

function isHumanCopilotEnabled() {
  return String(process.env.CHATBOT_HUMAN_COPILOT_ENABLED || '').trim() === '1';
}

function isCopilotSuggestedRepliesEnabled() {
  return String(process.env.CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED || '').trim() === '1';
}

function isCopilotAutoAssignEnabled() {
  return String(process.env.CHATBOT_COPILOT_AUTO_ASSIGN || '').trim() === '1';
}

function getCopilotHotLeadThreshold() {
  const raw = parseInt(process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD || '70', 10);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 70;
}

module.exports = {
  isHumanCopilotEnabled,
  isCopilotSuggestedRepliesEnabled,
  isCopilotAutoAssignEnabled,
  getCopilotHotLeadThreshold,
};
