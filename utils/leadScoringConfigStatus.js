'use strict';

const { isLeadScoringEnabled } = require('../services/chatbot/leadScoring/leadScoringFlags');

function getLeadScoringConfigStatus() {
  const enabled = isLeadScoringEnabled();
  return {
    enabled,
    ready: enabled,
  };
}

function logLeadScoringConfigStatus() {
  const status = getLeadScoringConfigStatus();
  console.log({
    leadScoringEnabled: process.env.CHATBOT_LEAD_SCORING_ENABLED,
    leadScoringReady: status.ready,
  });
}

module.exports = {
  getLeadScoringConfigStatus,
  logLeadScoringConfigStatus,
};
