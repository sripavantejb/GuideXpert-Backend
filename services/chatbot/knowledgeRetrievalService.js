const { buildLeadContext } = require('./leadContextService');
const { getDemoMeetingLink } = require('../../utils/slotNotificationFormatters');

/**
 * Facts bundle for orchestrator / LLM grounding.
 */
async function retrieveFacts(leadLinks) {
  const lead = await buildLeadContext(leadLinks);
  return {
    lead,
    links: {
      demoMeeting: getDemoMeetingLink(),
      iitCounsellingPage: process.env.IIT_COUNSELLING_PAGE_URL || null,
      frontendUrl: process.env.FRONTEND_URL || process.env.REGISTRATION_BASE_URL || null,
    },
  };
}

module.exports = { retrieveFacts };
