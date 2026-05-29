const { GLOBAL_KEYWORDS } = require('../../constants/chatbotStates');

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function matchesAny(text, phrases) {
  return phrases.some((p) => text.includes(p));
}

/**
 * Rule-based intent classification (Phase 1).
 * @returns {{ intent: string, confidence: 'high'|'medium'|'low' }}
 */
function classifyIntent(text, botState, productLine) {
  const t = normalizeText(text);

  if (matchesAny(t, GLOBAL_KEYWORDS.agent)) {
    return { intent: 'human_handoff', confidence: 'high' };
  }
  if (matchesAny(t, GLOBAL_KEYWORDS.menu)) {
    return { intent: 'main_menu', confidence: 'high' };
  }
  if (matchesAny(t, GLOBAL_KEYWORDS.stop)) {
    return { intent: 'opt_out', confidence: 'high' };
  }

  if (productLine === 'iit_counselling') {
    if (/^1$/.test(t)) return { intent: 'lead_lookup', confidence: 'high' };
    if (/^2$/.test(t)) return { intent: 'counselling_support', confidence: 'high' };
    if (/^3$/.test(t)) return { intent: 'lead_lookup', confidence: 'high' };
    if (/^4$/.test(t)) return { intent: 'rank_predictor', confidence: 'high' };
    if (/^5$/.test(t)) return { intent: 'college_predictor', confidence: 'high' };
    if (/^6$/.test(t)) return { intent: 'human_handoff', confidence: 'high' };
  }

  if (productLine === 'guidexpert') {
    if (/^[1-5]$/.test(t)) return { intent: 'faq', confidence: 'high' };
    if (/^6$/.test(t)) return { intent: 'human_handoff', confidence: 'high' };
  }

  if (productLine === 'unknown') {
    if (/^1$/.test(t)) return { intent: 'counselling_support', confidence: 'high' };
    if (/^2$/.test(t)) return { intent: 'demo_support', confidence: 'high' };
    if (/^3$/.test(t)) return { intent: 'rank_predictor', confidence: 'high' };
    if (/^4$/.test(t)) return { intent: 'human_handoff', confidence: 'high' };
  }

  if (/^1$|my details|my booking|my slot|profile/.test(t)) {
    return { intent: 'lead_lookup', confidence: 'high' };
  }
  if (/^2$|faq|question|help me/.test(t)) {
    return { intent: 'faq', confidence: 'high' };
  }
  if (/^3$|rank|predict rank|jee rank|eamcet rank/.test(t)) {
    return { intent: 'rank_predictor', confidence: 'high' };
  }
  if (/^4$|college|which college|colleges/.test(t)) {
    return { intent: 'college_predictor', confidence: 'medium' };
  }
  if (/^5$|agent|human|talk/.test(t)) {
    return { intent: 'human_handoff', confidence: 'high' };
  }

  if (productLine === 'iit_counselling') {
    if (/iit|counselling|counseling|session|slot|telugu|hindi|bda/.test(t)) {
      return { intent: 'counselling_support', confidence: 'medium' };
    }
  }

  if (productLine === 'guidexpert' || productLine === 'unknown') {
    if (/demo|meet|meeting|slot|register/.test(t)) {
      return { intent: 'demo_support', confidence: 'medium' };
    }
  }

  if (/when|what time|meeting link|reminder|whatsapp/.test(t)) {
    if (productLine === 'iit_counselling') {
      return { intent: 'counselling_support', confidence: 'medium' };
    }
    return { intent: 'demo_support', confidence: 'medium' };
  }

  if (botState && botState.state === 'rank_predictor') {
    return { intent: 'rank_predictor_continue', confidence: 'high' };
  }
  if (botState && botState.state === 'college_predictor') {
    return { intent: 'college_predictor_continue', confidence: 'high' };
  }
  if (botState && botState.state === 'faq') {
    return { intent: 'faq_query', confidence: 'medium' };
  }

  return { intent: 'unknown', confidence: 'low' };
}

module.exports = { classifyIntent, normalizeText };
