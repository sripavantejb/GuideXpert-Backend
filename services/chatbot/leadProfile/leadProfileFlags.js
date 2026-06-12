'use strict';

function isLeadProfileEnabled() {
  return String(process.env.CHATBOT_LEAD_PROFILE_ENABLED || '').trim() === '1';
}

module.exports = {
  isLeadProfileEnabled,
};
