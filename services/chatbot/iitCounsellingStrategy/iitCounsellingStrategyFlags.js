'use strict';

const { isIitCounsellingExpertEnabled } = require('../iitCounsellingExpert/iitCounsellingFlags');

function isIitCounsellingStrategyEnabled() {
  const strategyFlag =
    String(process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED || '').trim() === '1';
  return strategyFlag && isIitCounsellingExpertEnabled();
}

module.exports = {
  isIitCounsellingStrategyEnabled,
};
