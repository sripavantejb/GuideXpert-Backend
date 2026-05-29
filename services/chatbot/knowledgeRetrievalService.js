const { buildLeadContext } = require('./leadContextService');
const { getDemoMeetingLink } = require('../../utils/slotNotificationFormatters');

/**
 * Facts bundle for orchestrator / LLM grounding.
 * @param {object} leadLinks
 * @param {object|null} [leadContext] — pre-built context to avoid duplicate DB loads
 */
async function retrieveFacts(leadLinks, leadContext = null) {
  const lead = leadContext || (await buildLeadContext(leadLinks));
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
