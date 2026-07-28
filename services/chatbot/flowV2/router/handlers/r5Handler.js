'use strict';

/**
 * Flow v2 — R5 handler (asks about us).
 *
 * Copy is verbatim from spec. Sub-case selection uses the same patterns
 * `classifyReply` already matched on, re-checked here only to pick which
 * of the 3 given exchanges applies (`classifyReply` does not pass a
 * sub-case for R5, since all 5 trigger phrases funnel to just 3 replies).
 *
 * JUDGMENT CALL (flagged): the spec gave explicit verbatim copy for only
 * 3 of the 5 trigger phrases listed — "is this a bot", "is this free",
 * "how did you get my number". "who are you" has no distinct copy given
 * and is answered by the same bot-identity reply (it's a near-synonym
 * question). "how long will this take" also has no distinct copy given;
 * it falls back to the same bot-identity reply as the safest default
 * rather than inventing new copy. Flagged for confirmation — a dedicated
 * line for "how long will this take" may be wanted later.
 */

const BOT_IDENTITY_TEXT =
  "Yep — I'm Rithika, GuideXpert's AI counsellor. I do the shortlisting and comparisons, and when you're ready I hand you to a human counsellor for the personal session. Best of both. Want to carry on?";
const BOT_IDENTITY_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r5_continue', title: 'Sure, continue' }),
  Object.freeze({ id: 'flowv2_r5_get_human', title: 'Get me a human' }),
]);

const IS_FREE_TEXT =
  "This chat is completely free, and so is the 1-on-1 session. Nothing to pay at any point here. So — where are you right now?";

const HOW_GOT_NUMBER_TEXT =
  "You messaged us first — this is GuideXpert's official WhatsApp. If you'd rather not continue, just say stop and I won't message again.";

const IS_FREE_PATTERN = /\bis this free\b/i;
const HOW_GOT_NUMBER_PATTERN = /\bhow did you get my number\b/i;

function standardShape(replyText, interactive = null) {
  return {
    replyText,
    replyParts: null,
    interactive,
    contextPatch: {},
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {object} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape
 */
function handleR5(ctx, text) {
  const t = String(text || '').toLowerCase();

  if (IS_FREE_PATTERN.test(t)) {
    return standardShape(IS_FREE_TEXT);
  }
  if (HOW_GOT_NUMBER_PATTERN.test(t)) {
    return standardShape(HOW_GOT_NUMBER_TEXT);
  }
  // "is this a bot", "who are you", and the "how long" fallback (see
  // judgment-call note above) all resolve to the bot-identity reply. The
  // buttons attach directly to this message (one bubble), so replyText
  // stays null and the text travels as the interactive body instead —
  // same convention as Node 0's backfill question.
  return standardShape(null, {
    type: 'button',
    body: BOT_IDENTITY_TEXT,
    buttons: BOT_IDENTITY_BUTTONS,
  });
}

module.exports = {
  handleR5,
  BOT_IDENTITY_TEXT,
  BOT_IDENTITY_BUTTONS,
  IS_FREE_TEXT,
  HOW_GOT_NUMBER_TEXT,
};
