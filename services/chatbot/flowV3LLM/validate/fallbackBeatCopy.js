'use strict';

/**
 * F-4 — Tier A fallback copy: the REAL Flow V2 beat questions.
 *
 * Architecture §7.3 Tier A: "re-ask the current slot using the Flow V2
 * hardcoded copy for that beat. Do not paraphrase." These are imported
 * directly from the frozen V2 node modules — verbatim by construction, and
 * they track any future certified copy change automatically. The V2 nodes
 * are consumed read-only; nothing in flowV2/** changes.
 *
 * Coverage is intentionally exact: the V3 slot walk asks six slots
 * (qualification, goalPriority, goal, interests, budgetBand, cityPref).
 * A slot with no V2 copy must fall through to Tier B — the ladder never
 * invents student-facing copy.
 */

const { NEUTRAL_QUALIFICATION_LINE } = require('../../flowV2/nodes/greeting');
const { B1_QUESTION_TAIL } = require('../../flowV2/nodes/b1Goal');
const { B2_BODY } = require('../../flowV2/nodes/b2Goal');
const { B2_QUESTION } = require('../../flowV2/nodes/b2Branch');
const { BUDGET_QUESTION, LOCATION_QUESTION_ONLY } = require('../../flowV2/nodes/b3Constraints');

const FALLBACK_BEAT_COPY = Object.freeze({
  qualification: NEUTRAL_QUALIFICATION_LINE, // greeting node
  goalPriority: B1_QUESTION_TAIL, //            B1 node
  goal: B2_BODY, //                             B2 goal node
  interests: B2_QUESTION, //                    B2 branch/interest node
  budgetBand: BUDGET_QUESTION, //               B3 constraints node
  cityPref: LOCATION_QUESTION_ONLY, //          B3 constraints node
});

/** @returns {string|null} verbatim V2 ask copy for a slot, or null */
function beatCopyForSlot(slot) {
  const copy = FALLBACK_BEAT_COPY[slot];
  return typeof copy === 'string' && copy.length ? copy : null;
}

module.exports = { FALLBACK_BEAT_COPY, beatCopyForSlot };
