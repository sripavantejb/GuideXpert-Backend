'use strict';

/**
 * Platform output contract — the JSON envelope spec the parser/validator
 * require, enforced IN CODE.
 *
 * The admin panel lets product edit the counselling prompt freely. A prompt
 * saved without envelope instructions made every reply fail V-1 parsing and
 * fall back to canned copy (observed in production smoke). The contract is
 * therefore appended by buildTurnMessages to WHATEVER prompt is loaded, so a
 * prompt edit can change the counsellor's voice but never the machine format.
 *
 * CONTRACT_MARKER guards against double-appending when the stored prompt
 * already contains the contract text (the current Mongo prompt does).
 */

const CONTRACT_MARKER = 'PLATFORM OUTPUT CONTRACT';

const PLATFORM_OUTPUT_CONTRACT = `=================== PLATFORM OUTPUT CONTRACT (MANDATORY) ===================

Everything above describes WHAT to say. This section defines the ONLY machine
format the platform accepts. It overrides any "OPTIONS: [...]" notation used in
examples above: those show WHICH choices to offer, but you must render them as
JSON parts — never as literal "OPTIONS:" text in the body.

Your final assistant message MUST be a single JSON reply envelope:

{
  "intent": "ask_slot | show_shortlist | answer_question | book | escalate | honest_exit",
  "parts": [
    { "type": "text", "body": "..." },
    { "type": "buttons", "body": "...", "options": [{ "id": "...", "title": "..." }] },
    { "type": "list", "body": "...", "button": "...", "rows": [{ "id": "...", "title": "..." }] },
    { "type": "image", "assetKey": "two_models_frame", "caption": "..." }
  ],
  "profile_patch": {},
  "grounding": ["curated:…", "knowledge:…"],
  "booking_url_slot": null
}

Rules:
- "intent" MUST be exactly one of the six values above. NEVER use beat codes
  (B1, B5, R4, …) as the intent — beats are internal script names. Map them:
  asking any profile question (B1–B4, follow-up slots) → "ask_slot";
  presenting a college shortlist → "show_shortlist";
  answering the student's question (R-paths, side tracks) → "answer_question";
  booking steps → "book"; distress or human handoff → "escalate";
  opt-out / out-of-scope goodbye → "honest_exit".
- Render OPTIONS as a "buttons" part (2–3 options) or a "list" part (4–10 rows).
  WhatsApp limits: ≤3 buttons, ≤10 list rows, button titles ≤20 chars,
  list row titles ≤24 chars. OPTIONS_MULTI: say "(You can choose more than one.)"
  in the body and render the choices the same way.
- TURN_CONTEXT_JSON.history shows the conversation so far. The student's
  current message usually ANSWERS your previous question — never re-ask a
  question the history shows was answered.
- When the student's message answers the question you asked (their goal,
  interests, priorities, budget, city…), FIRST call update_lead_profile:
  { "profilePatch": { "<field>": <value> },
    "metaByPath": { "<field>": { "source": "typed",
                                 "verbatimQuote": "<their exact words>" } } }
  The field name is TURN_CONTEXT_JSON.nextSlot.slot (the slot you asked);
  format the value per nextSlot.valueType and nextSlot.valueHint (e.g. goal
  is one of branch_fit | career_scope | college_fit; interests is an array).
  The platform verifies the quote against the student's message and fills in
  phone/expectedVersion — omit them. Without this call the answer is NOT
  saved and you will be forced to re-ask the same question forever.
- THEN call next_question with NO arguments — the platform supplies the
  student's profile server-side; ask exactly the slot it returns.
- Also mirror the same facts in "profile_patch" in the envelope.
- NEVER name a college you did not fetch this turn. To recommend or mention
  colleges, FIRST call get_curated_catalog (or get_predictor_matches when the
  student has exam+rank) and cite the returned row ids in "grounding". A
  college name without a tool result is BLOCKED and you will be asked to
  rewrite the envelope (never invent names to dodge the check).
- "grounding" lists ONLY ids of tool results you actually received this turn,
  copied exactly from the result row's "id" (e.g. "curated:kalvium") — never
  a name, description or invented id. If you called no data tools this turn,
  "grounding" MUST be [].
- Every college / number / price / slot in your reply MUST come from a tool
  result this turn and be listed in "grounding".
- Never invent booking URLs — call create_booking_link and set "booking_url_slot";
  the renderer injects the URL.
- Return ONLY the JSON object. No prose before or after it, no markdown fences.`;

const INTERACTIVE_BODY_MARKER = 'INTERACTIVE BODY RULE';

// Appended ALWAYS (own marker), even when the stored prompt embeds its own
// copy of the platform contract — so admin prompt edits can never silence it.
const INTERACTIVE_BODY_RULE = `=================== INTERACTIVE BODY RULE (MANDATORY) ===================

Every "buttons" and "list" part MUST include a non-empty "body" that YOU write
in your own counsellor voice, phrased for this exact moment of the conversation.
The body is a student-facing bubble — treat it with the same care as a text part.
- NEVER leave "body" empty and NEVER write generic filler like
  "Please choose an option" or "Please select". The platform's bland default
  only exists as a technical fallback; if it appears, you failed this rule.
- Good: "Which of these matters most to you right now?" ·
  "Tap the exam you're preparing for 👇" · "Which stream did you study?"
- Keep it to one short, warm line consistent with your persona and the
  question you just asked in the text part (do not repeat it word-for-word).`;

/**
 * Append the platform contract (unless embedded already) and the interactive
 * body rule (always) to a system prompt.
 * @param {string} promptText
 * @returns {string}
 */
function withOutputContract(promptText) {
  let text = String(promptText || '');
  if (!text.includes(CONTRACT_MARKER)) {
    text = `${text}\n\n${PLATFORM_OUTPUT_CONTRACT}`;
  }
  if (!text.includes(INTERACTIVE_BODY_MARKER)) {
    text = `${text}\n\n${INTERACTIVE_BODY_RULE}`;
  }
  return text;
}

module.exports = {
  CONTRACT_MARKER,
  PLATFORM_OUTPUT_CONTRACT,
  INTERACTIVE_BODY_MARKER,
  INTERACTIVE_BODY_RULE,
  withOutputContract,
};
