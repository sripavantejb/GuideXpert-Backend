'use strict';

/**
 * Sticky IIT Counselling journey — session ownership, context expansion (routing only),
 * scope-firewall interaction. Does not call RAG/LLM/vector search.
 */

const {
  isIitCounsellingExpertEnabled,
} = require('./iitCounsellingFlags');
const {
  isIitCounsellingExpertSessionActive,
  isIitCounsellingExpertQuestion,
  isIitCounsellingEntryRequest,
  isIitCounsellingInSessionTopic,
  resolveIitContextExpansion,
} = require('./iitCounsellingIntentService');

const { normalizeText } = require('../intentTextUtils');

/** Exit sticky IIT journey — Part 9. */
const IIT_SESSION_EXIT_RE =
  /^(main menu|menu|home|restart|start over|start again|cancel|cancel iit|exit counselling|exit counseling|bye|goodbye|good bye|see you|talk later|exit|quit)$/i;

function isIitSessionExitRequest(text, originalText = null) {
  const candidates = [normalizeText(text), normalizeText(originalText || '')].filter(Boolean);
  return candidates.some((t) => IIT_SESSION_EXIT_RE.test(t));
}

/**
 * Foundation must not steal IIT short-forms while session is active,
 * and must not intercept cold-start IIT process vocabulary / entry phrases.
 */
function shouldDeferFoundationForIit(text, originalText, botState, productLine = null) {
  if (!isIitCounsellingExpertEnabled()) return false;
  if (isIitSessionExitRequest(text, originalText)) return false;
  if (isIitCounsellingExpertSessionActive(botState)) {
    const t = normalizeText(text);
    if (/^(english|hindi|telugu|తెలుగు|हिंदी|தமிழ்)$/i.test(t)) return false;
    if (/\b(switch to|change language|language please)\b/i.test(t)) return false;
    return true;
  }
  // Cold start: defer only strong IIT entry / JoSAA vocabulary — not generic
  // single words (Documents) on non-IIT product lines (Foundation owns those).
  if (isIitCounsellingEntryRequest(text, originalText)) return true;
  if (isIitCounsellingExpertQuestion(text, originalText)) {
    // Pattern-matched JoSAA/process questions — always defer.
    if (!isIitCounsellingInSessionTopic(text, originalText)) return true;
    // Short ambiguous tokens (Documents, Fee, Round) — only on IIT product line.
    return productLine === 'iit_counselling';
  }
  return false;
}

/**
 * Scope firewall runs only for non-IIT context when journey is sticky/ICE-bound.
 * True OOS (Python, IPL) still hits the firewall.
 */
function shouldBypassScopeFirewallForIit(botState, text, originalText, intent) {
  if (!isIitCounsellingExpertEnabled()) return false;
  if (isIitSessionExitRequest(text, originalText)) return false;

  const sessionActive = isIitCounsellingExpertSessionActive(botState);
  const iceIntent =
    intent === 'iit_counselling_expert' ||
    intent === 'iit_counselling_strategy' ||
    intent === 'jee_exam_clarify' ||
    intent === 'jee_main_counselling';

  if (!sessionActive && !iceIntent) return false;

  // Never bypass obvious out-of-domain when sticky — leave those to the firewall.
  if (isObviousOutOfIitDomain(text, originalText)) return false;

  if (sessionActive && isIitCounsellingInSessionTopic(text, originalText)) return true;
  if (sessionActive && iceIntent && !isObviousOutOfIitDomain(text, originalText)) {
    // Sticky session owns short / contextual follow-ups classified as ICE.
    return true;
  }
  if (
    iceIntent &&
    (isIitCounsellingExpertQuestion(text, originalText) || isIitCounsellingEntryRequest(text, originalText))
  ) {
    return true;
  }
  // Strategy questions (rank + college options) stay inside IIT/JEE — never firewall.
  if (intent === 'iit_counselling_strategy') return true;
  return false;
}

function isObviousOutOfIitDomain(text, originalText = null) {
  const hay = `${text || ''} ${originalText || ''}`.toLowerCase();
  return (
    /\b(python|javascript|java code|ipl|cricket|movie|bollywood|politics|weather|bitcoin|crypto|amazon|flipkart|myntra|meesho|shopping)\b/i.test(
      hay
    ) ||
    /\b(teach me|write (a |some )?code|who won|shop on|buy (a |an |the )?(laptop|phone))\b/i.test(hay)
  );
}

/**
 * Routing-only expansion before Scope Firewall / ICE.
 * @returns {{
 *   sessionActive: boolean,
 *   exitSession: boolean,
 *   expandedText: string|null,
 *   routeToIce: boolean,
 *   bypassScope: boolean,
 *   deferFoundation: boolean,
 * }}
 */
function resolveIitSessionTurn({ text, originalText = null, botState = null, intent = null } = {}) {
  const raw = String(originalText || text || '').trim();
  const sessionActive = isIitCounsellingExpertSessionActive(botState);
  const exitSession = isIitSessionExitRequest(text, originalText);
  const expansion = resolveIitContextExpansion(text, originalText);
  const expandedText = expansion || null;
  const deferFoundation = shouldDeferFoundationForIit(
      text,
      originalText,
      botState,
      null
    );
  const routeToIce =
    !exitSession &&
    isIitCounsellingExpertEnabled() &&
    (sessionActive ||
      isIitCounsellingEntryRequest(text, originalText) ||
      isIitCounsellingExpertQuestion(text, originalText) ||
      isIitCounsellingInSessionTopic(text, originalText));
  const bypassScope = shouldBypassScopeFirewallForIit(botState, text, originalText, intent);

  return {
    sessionActive,
    exitSession,
    expandedText,
    expansionReason: expansion ? 'iit_context_resolver' : null,
    routeToIce,
    bypassScope,
    deferFoundation,
    raw,
  };
}

module.exports = {
  isIitSessionExitRequest,
  shouldDeferFoundationForIit,
  shouldBypassScopeFirewallForIit,
  isObviousOutOfIitDomain,
  resolveIitSessionTurn,
};
