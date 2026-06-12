'use strict';

function isLeadScoringEnabled() {
  return String(process.env.CHATBOT_LEAD_SCORING_ENABLED || '').trim() === '1';
}

module.exports = {
  isLeadScoringEnabled,
};
