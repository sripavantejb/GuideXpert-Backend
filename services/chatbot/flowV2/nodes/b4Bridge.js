'use strict';

/**
 * Flow v2 — B4 · Bridge.
 *
 * A single, gate-free message between B3 · Constraints and B5 · Explore
 * (not built until Phase 6). `handleB4Entry` is the ONLY export — this
 * beat never waits for a student reply, so there is deliberately no
 * `handleB4Reply`. It is reached exclusively by another node calling it
 * directly within the same turn (`b3Constraints.js`'s "both slots already
 * filled" skip case, and its own budget/location reply branches once B3's
 * questions are answered) — never dispatched to from a "the student just
 * replied" stage.
 */

const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');

const BRIDGE_TEXT = [
  'Before I show you the list \u2014 one thing worth saying.',
  '',
  "Most students compare on brand and fees. What actually moves the needle is projects, mentorship and internships. That's what I'm weighting for you.",
].join('\n');

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @returns {object} standard Flow v2 node return shape
 */
function handleB4Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  return {
    replyText: BRIDGE_TEXT,
    replyParts: null,
    interactive: null,
    // `profile` is carried forward exactly like every other "chain
    // straight into the next beat without waiting for a reply" branch
    // must (the Phase 4 propagation bug was this exact shape) — B4 never
    // mutates the profile itself, but the caller (B3) may have.
    contextPatch: { stage: 'b5_awaiting_entry', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleB4Entry,
  BRIDGE_TEXT,
};
