'use strict';

const { isLeadProfileEnabled } = require('../services/chatbot/leadProfile/leadProfileFlags');

function getLeadProfileConfigStatus() {
  const enabled = isLeadProfileEnabled();
  return {
    enabled,
    ready: enabled,
  };
}

function logLeadProfileConfigStatus() {
  const status = getLeadProfileConfigStatus();
  console.log({
    leadProfileEnabled: process.env.CHATBOT_LEAD_PROFILE_ENABLED,
    leadProfileReady: status.ready,
  });
}

module.exports = {
  getLeadProfileConfigStatus,
  logLeadProfileConfigStatus,
};
