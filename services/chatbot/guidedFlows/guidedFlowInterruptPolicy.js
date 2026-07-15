'use strict';

const { isExplicitHumanHandoffRequest } = require('../foundationConversation/humanHandoffIntent');
const { GLOBAL_KEYWORDS } = require('../../../constants/chatbotStates');
const { normalizeText, matchesAny, matchesMenuCommands } = require('../intentTextUtils');

const EXPLICIT_EXIT_RE =
  /^(home|exit|main menu|main_menu|stop|unsubscribe|opt out|optout|cancel|restart|start over|start again|reset|new prediction)$/i;

/**
 * Returns true when the user explicitly intends to leave the active guided workflow.
 * Slot values, greetings, emoji, and small talk are NOT interrupts.
 */
function isGuidedFlowInterrupt(text, originalText = null) {
  const trimmed = String(originalText || text || '').trim();
  const t = normalizeText(text);

  if (EXPLICIT_EXIT_RE.test(trimmed)) return true;
  if (matchesMenuCommands(t)) return true;
  if (matchesAny(t, GLOBAL_KEYWORDS.cancel)) return true;
  if (matchesAny(t, GLOBAL_KEYWORDS.stop)) return true;
  if (isExplicitHumanHandoffRequest(t, originalText)) return true;

  return false;
}

module.exports = {
  isGuidedFlowInterrupt,
  EXPLICIT_EXIT_RE,
};
