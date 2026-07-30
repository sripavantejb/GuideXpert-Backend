'use strict';

/**
 * OpenAI-compatible tool definitions for the Flow V3 broker allowlist.
 * Schemas are intentionally permissive on properties — tools self-enforce.
 */

const { FLOW_V3_TOOL_ALLOWLIST } = require('./toolBroker');

const TOOL_DESCRIPTIONS = Object.freeze({
  next_question: 'Return the next profile slot the student should be asked (deterministic beat order).',
  get_curated_catalog: 'Return the curated 10-row modern-college catalog (tag: curated).',
  get_predictor_matches: 'Return CollegeDost Top Matches for the student profile (tag: predictor). Refuses AP+OC+male.',
  get_booking_slots: 'Return live GuidanceSlot options for hybrid booking handoff.',
  search_knowledge: 'Search the knowledge base; returns chunk ids for grounding.',
  update_lead_profile: 'CAS-merge an allowlisted profile patch with capture meta.',
  create_booking_link: 'Create the official website booking URL for a serviceKey (no CRM write).',
  escalate_to_human: 'Escalate to human counsellor / crisis handoff.',
});

function openaiToolDefinitions() {
  return FLOW_V3_TOOL_ALLOWLIST.map((name) => ({
    type: 'function',
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name] || name,
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    },
  }));
}

module.exports = {
  TOOL_DESCRIPTIONS,
  openaiToolDefinitions,
};
