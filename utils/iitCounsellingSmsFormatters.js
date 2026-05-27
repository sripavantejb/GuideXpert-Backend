/**
 * IIT counselling SMS helpers (re-export meet link from template config).
 */
const {
  getIitCounsellingMeetLink,
  buildFlowVariablesForKind,
} = require('../config/iitTeluguSmsTemplates');

module.exports = {
  getIitCounsellingMeetLink,
  buildFlowVariablesForKind,
};
