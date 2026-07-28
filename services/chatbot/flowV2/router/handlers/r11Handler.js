'use strict';

/**
 * Flow v2 — R11 handler (out of scope).
 *
 * DEFAULTED PENDING BUSINESS CONFIRMATION — Assumption 2 / medical·law·MBA
 * scope (Part 2.3 / 18). Chatbot depth is engineering/tech in India only.
 * See careerCounsellingFlowV2BusinessDefaults.js · ENGINEERING_TECH_SCOPE_ONLY.
 *
 * Single verbatim message + Book/Tell-me-anyway buttons, per spec.
 */

const OUT_OF_SCOPE_TEXT =
  "Honest answer — my depth is engineering and tech programs in India, so I'd rather not guess at medical admissions and point you wrong. Our counsellors do cover this properly though. Want me to book you with the right person?";
const OUT_OF_SCOPE_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r11_book_session', title: 'Book a session' }),
  Object.freeze({ id: 'flowv2_r11_tell_me_anyway', title: 'Tell me about tech anyway' }),
]);

/**
 * @returns {object} standard Flow v2 node return shape
 */
function handleR11() {
  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: OUT_OF_SCOPE_TEXT,
      buttons: OUT_OF_SCOPE_BUTTONS,
    },
    contextPatch: {},
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleR11,
  OUT_OF_SCOPE_TEXT,
  OUT_OF_SCOPE_BUTTONS,
};
