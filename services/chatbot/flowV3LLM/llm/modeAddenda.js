'use strict';

/**
 * Per-turn system-message addenda for LLM-only recovery paths.
 * Appended via buildTurnMessages({ systemExtra }) — never replace the
 * admin-panel prompt; they only constrain a single recovery attempt.
 */

const OUTAGE_APOLOGY =
  "Sorry — I'm having a brief connection issue. Please send that again in a moment.";

const CRISIS_BACKSTOP =
  "I'm really glad you reached out. Please contact Tele-MANAS at 14416 — a human counsellor can help right away.";

const SECURITY_REFUSAL =
  "I can't help with that request. Happy to stick to college and career questions whenever you're ready.";

const SAFE_MODE_ADDENDUM = `=================== SAFE MODE (THIS TURN ONLY) ===================

Your previous reply was rejected by the platform. Produce a CORRECTED envelope now.

Hard rules for this turn:
- Answer the student's latest message first, then continue the counselling journey.
- NEVER use the words "guarantee", "guaranteed", or "100%" about admissions, jobs, placements, or salaries. Reframe honestly without those words.
- Do NOT name any college, fee, placement %, or rank cutoff unless you fetched it THIS turn via a tool and listed its id in "grounding". If you have no tool data, say you don't have verified figures and offer to continue or book a free counsellor session.
- Prefer intent "answer_question" or "ask_slot". Avoid "honest_exit" unless the student explicitly said stop / don't message me.
- Keep 2–3 short WhatsApp lines. Return ONLY the JSON envelope.`;

const CRISIS_MODE_ADDENDUM = `=================== CRISIS MODE (THIS TURN ONLY) ===================

The student may be in emotional distress / self-harm risk. This overrides every counselling objective.

Hard rules for this turn:
- Reply with compassion and calm. Acknowledge they reached out.
- You MUST include the exact helpline text: Tele-MANAS at 14416.
- Do NOT ask counselling questions (qualification, budget, colleges, booking).
- Do NOT continue the college journey this turn.
- intent MUST be "escalate".
- parts: one short text part only (no buttons/list/image).
- profile_patch: {}. grounding: []. booking_url_slot: null.
- Return ONLY the JSON envelope.`;

module.exports = {
  OUTAGE_APOLOGY,
  CRISIS_BACKSTOP,
  SECURITY_REFUSAL,
  SAFE_MODE_ADDENDUM,
  CRISIS_MODE_ADDENDUM,
};
