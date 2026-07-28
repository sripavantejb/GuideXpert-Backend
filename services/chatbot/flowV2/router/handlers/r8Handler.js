'use strict';

/**
 * Flow v2 — R8 handler (not the student).
 *
 * 3 sub-cases, copy verbatim from spec: parent framing (sets
 * `profile.isParent = true`), vendor/spam, wrong number.
 */

const { mergeFlowV2Profile } = require('../../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../../constants/careerCounsellingFlowV2Profile');

const PARENT_TEXT =
  "It's really good that you're guiding her — students decide much better with a parent involved. Most parents I speak with weigh three things: safety, placements and fees. Shall I shortlist with those first?";
const PARENT_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r8_safety_jobs', title: 'Yes — safety & jobs first' }),
  Object.freeze({ id: 'flowv2_r8_fees_first', title: 'Fees matter most' }),
  Object.freeze({ id: 'flowv2_r8_she_should_choose', title: 'She should choose' }),
]);

const VENDOR_SPAM_TEXT =
  'This line is for student counselling only. For business queries, please use the contact form on guidexpert.co.in.';

const WRONG_NUMBER_TEXT = 'No worries at all! If you ever need college guidance, you know where I am. 👍';

const PARENT_PATTERN = /\bmy (son|daughter)\b/i;
const WRONG_NUMBER_PATTERN = /\bwrong number\b/i;

/**
 * @param {object} ctx
 * @param {string} text
 * @param {{ subCase?: string|null }} [classification]
 * @returns {object} standard Flow v2 node return shape
 */
function handleR8(ctx, text, classification = {}) {
  const t = String(text || '').toLowerCase();

  if (PARENT_PATTERN.test(t)) {
    const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();
    const mergedProfile = mergeFlowV2Profile(currentProfile, { isParent: true });
    return {
      replyText: null,
      replyParts: null,
      interactive: {
        type: 'button',
        body: PARENT_TEXT,
        buttons: PARENT_BUTTONS,
      },
      contextPatch: { profile: mergedProfile },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  if (WRONG_NUMBER_PATTERN.test(t)) {
    return standardTextShape(WRONG_NUMBER_TEXT);
  }

  // vendor/spam sub-case (classification.subCase === 'vendor_spam') or any
  // other R8 hit that isn't parent/wrong-number framing.
  return standardTextShape(VENDOR_SPAM_TEXT);
}

function standardTextShape(replyText) {
  return {
    replyText,
    replyParts: null,
    interactive: null,
    contextPatch: {},
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleR8,
  PARENT_TEXT,
  PARENT_BUTTONS,
  VENDOR_SPAM_TEXT,
  WRONG_NUMBER_TEXT,
};
