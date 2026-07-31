'use strict';

/**
 * OpenAI-compatible tool definitions for the Flow V3 broker allowlist.
 *
 * update_lead_profile and next_question carry REAL parameter schemas: with
 * `properties: {}` the model had no idea what arguments the write tool took
 * and simply never called it, so free-text slots (goal, interests) never
 * filled and the beat walk looped on the same question forever (conformance
 * finding G-2). Tools still self-enforce — the schema is guidance, the
 * broker/tool layer is the enforcement.
 */

const { FLOW_V3_TOOL_ALLOWLIST } = require('./toolBroker');

const TOOL_DESCRIPTIONS = Object.freeze({
  next_question:
    'Return the next profile slot the student should be asked (deterministic beat order). Takes no arguments — the platform supplies the student profile server-side.',
  get_curated_catalog: 'Return the curated 10-row modern-college catalog (tag: curated).',
  get_predictor_matches:
    'Return CollegeDost Top Matches for the student profile (tag: predictor). Refuses AP+OC+male.',
  get_booking_slots: 'Return live GuidanceSlot options for hybrid booking handoff.',
  search_knowledge: 'Search the knowledge base; returns chunk ids for grounding.',
  update_lead_profile:
    "REQUIRED whenever the student's message answers a profile question (their goal, interests, priorities, budget, city…). Saves the answer durably; without this call the same question will be re-asked. Omit phone/expectedVersion — the platform fills them. verbatimQuote must be the student's exact words from their message (the platform verifies it).",
  create_booking_link: 'Create the official website booking URL for a serviceKey (no CRM write).',
  escalate_to_human: 'Escalate to human counsellor / crisis handoff.',
});

/** Real parameter schemas where they change model behaviour. */
const TOOL_PARAMETERS = Object.freeze({
  next_question: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  update_lead_profile: {
    type: 'object',
    properties: {
      profilePatch: {
        type: 'object',
        description:
          'Profile fields captured from the student this turn, e.g. { "goal": "clear direction choosing a college", "interests": ["coding", "robotics"] }.',
        additionalProperties: true,
      },
      metaByPath: {
        type: 'object',
        description:
          'One entry per profilePatch field: { "<field>": { "source": "typed", "verbatimQuote": "<the student\'s exact words>" } }.',
        additionalProperties: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['typed', 'inferred'] },
            verbatimQuote: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['source', 'verbatimQuote'],
        },
      },
    },
    required: ['profilePatch', 'metaByPath'],
    additionalProperties: true,
  },
  search_knowledge: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look up.' },
    },
    required: ['query'],
    additionalProperties: true,
  },
});

const PERMISSIVE = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: true,
});

function openaiToolDefinitions() {
  return FLOW_V3_TOOL_ALLOWLIST.map((name) => ({
    type: 'function',
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name] || name,
      parameters: TOOL_PARAMETERS[name] || PERMISSIVE,
    },
  }));
}

module.exports = {
  TOOL_DESCRIPTIONS,
  TOOL_PARAMETERS,
  openaiToolDefinitions,
};
