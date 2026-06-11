'use strict';

function isIitCounsellingExpertEnabled() {
  return String(process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED || '').trim() === '1';
}

module.exports = {
  isIitCounsellingExpertEnabled,
};
