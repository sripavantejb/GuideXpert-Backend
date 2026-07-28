'use strict';

/**
 * Flow v2 — R9 handler (non-text).
 *
 * No OCR infrastructure exists anywhere in this codebase (confirmed by
 * search) — the marksheet-vs-sticker distinction from spec therefore
 * collapses to a `messageType`-only mapping this phase:
 *   - 'audio' (voice note)        -> voice-note line + 9-row list
 *   - 'image' / 'document'        -> no-OCR line only (matches spec copy
 *                                     exactly — no list attached to that line)
 *   - anything else non-text      -> sticker/emoji catch-all line + list
 * OCR remains an explicitly out-of-scope future dependency — no stub call
 * is made here for it; when OCR infra exists, the 'image'/'document'
 * branch is the one to extend with an eligibility-routing reply.
 */

const { buildQualificationListInteractive } = require('../../nodes/greeting');

const NO_OCR_TEXT = "Thanks! I can't read images clearly — could you just type the rank or percentage?";
const VOICE_NOTE_TEXT = "I can't play voice notes yet, sorry! Quick tap instead — where are you right now?";
const STICKER_EMOJI_TEXT = '🙂 Let\u2019s get you started — where are you right now?';

/**
 * @param {object} ctx
 * @param {string} text
 * @param {{ subCase?: string }} [classification] - subCase is the raw messageType
 * @returns {object} standard Flow v2 node return shape
 */
function handleR9(ctx, text, classification = {}) {
  const messageType = classification.subCase || 'unknown';

  if (messageType === 'image' || messageType === 'document') {
    return {
      replyText: NO_OCR_TEXT,
      replyParts: null,
      interactive: null,
      contextPatch: {},
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  const leadInText = messageType === 'audio' ? VOICE_NOTE_TEXT : STICKER_EMOJI_TEXT;
  return {
    replyText: null,
    replyParts: null,
    interactive: buildQualificationListInteractive(leadInText),
    contextPatch: {},
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleR9,
  NO_OCR_TEXT,
  VOICE_NOTE_TEXT,
  STICKER_EMOJI_TEXT,
};
