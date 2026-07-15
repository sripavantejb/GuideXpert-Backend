'use strict';

/**
 * Foundation Conversation Router
 *
 * Runs BEFORE Scope Firewall. Deterministic — no RAG, no LLM, no vector search.
 * Returns fixed replies for everyday assistant conversation.
 */

const { normalizeText } = require('../intentTextUtils');
const {
  FOUNDATION_REPLIES,
  CLARIFICATION_BY_TOPIC,
} = require('../../../constants/foundationConversationReplies');
const { isExplicitHumanHandoffRequest } = require('./humanHandoffIntent');
const { isSupportedLanguage, normalizeLanguageCode } = require('../../../constants/languageConstants');

function intentTextCandidates(text, originalText = null) {
  const normalized = normalizeText(text);
  const original = originalText ? normalizeText(originalText) : null;
  if (original && original !== normalized) {
    return [normalized, original];
  }
  return [normalized];
}

const CATEGORY = Object.freeze({
  GREETING: 'greeting',
  IDENTITY: 'identity',
  CAPABILITY: 'capability',
  NAVIGATION: 'navigation',
  GRATITUDE: 'gratitude',
  GOODBYE: 'goodbye',
  SMALL_TALK: 'small_talk',
  LANGUAGE_SWITCH: 'language_switch',
  CLARIFICATION: 'clarification',
});

const GREETING_RE =
  /^(hi+|hii+|hiiii+|hello+|hey+|helo+|hell+o+|yo|sup|greetings|namaste|vanakkam|salaam|hola|start|\/start|hi there|hello there|hey there|hello again|hello guidexpert|hey guidexpert|hi guidexpert|what'?s up|whats up)[\s!.]*$/i;

const TIME_GREETING_RE =
  /^(good\s+(morning|afternoon|evening|night)|gm|gn)[\s!.]*$/i;

const NATIVE_GREETING_RE =
  /^(नमस्ते|నమస్కారం|నమస్తే|హలో|வணக்கம்|ഹലോ|नमस्कार|নমস্কার)[\s!.]*$/i;

const MIXED_GREETING_RE =
  /^(hello|hi|hey)\s+(नमस्ते|నమస్తే|హలో|வணக்கம்|ഹലോ)[\s!.]*$/i;

const IDENTITY_RE =
  /^(who are you|what are you|are you (chatgpt|gpt|ai|an ai|a bot|a chatbot|human|a human|real)|who created you|who made you|what company (are you from|do you work for)|what is guidexpert|tell me about guidexpert|about guidexpert)[\s?!.]*$/i;

const CAPABILITY_RE =
  /^(what can you do|how can you help( me)?|can you help me|what (services|all) do you (provide|offer)|how do you help|what do you do)[\s?!.]*$/i;

const NAVIGATION_RE =
  /^(help|support|menu|main menu|main_menu|home|restart|start over|start again|back|go back|cancel)[\s!.]*$/i;

const GRATITUDE_RE =
  /^(thanks|thank you|thank you so much|thx|ty|awesome|great|perfect|nice|helpful|love it|excellent|wonderful)[\s!.]*$/i;

const GOODBYE_RE =
  /^(bye|goodbye|good bye|see you|see ya|talk later|catch you later|exit|quit|stop|take care|ttyl)[\s!.]*$/i;

const SMALL_TALK_RE =
  /^(how are you|how are u|how r u|hope you('?re| are) doing well|how('?s| is) your day|nice to meet you|good job|well done)[\s?!.]*$/i;

const LANGUAGE_SWITCH_RE =
  /\b(switch to|change (to )?language|language|prefer|reply in|speak)\b.+\b(english|hindi|telugu|tamil|kannada|malayalam|marathi|bengali|en|hi|te|ta|kn|ml|mr|bn)\b|\b(english|hindi|telugu|tamil)\s*(please|pls)?\s*$|^(english|hindi|తెలుగు|हिंदी|தமிழ்)$/i;

const CLARIFICATION_MAP = Object.freeze([
  { topic: 'admission', re: /^(admission|admissions|admision)$/i },
  { topic: 'fees', re: /^(fees?|fee|pricing|cost)$/i },
  { topic: 'documents', re: /^(documents?|docs|paperwork)$/i },
  { topic: 'scholarship', re: /^(scholarship|scholarships)$/i },
  { topic: 'hostel', re: /^(hostel|hostels)$/i },
  { topic: 'placements', re: /^(placements?|placement)$/i },
  { topic: 'iit', re: /^(iit|iits)$/i },
  { topic: 'nit', re: /^(nit|nits)$/i },
  { topic: 'college', re: /^(college|colleges)$/i },
  { topic: 'counselling', re: /^(counselling|counseling)$/i },
]);

const EMPTY_OR_EMOJI_RE =
  /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}❤️❤]+$/u;

const PUNCT_ONLY_RE = /^[?.!…]+$|^\.{2,}$/;

const LANG_ALIAS = Object.freeze({
  english: 'en',
  en: 'en',
  hindi: 'hi',
  hi: 'hi',
  हिंदी: 'hi',
  telugu: 'te',
  te: 'te',
  తెలుగు: 'te',
  tamil: 'ta',
  ta: 'ta',
  தமிழ்: 'ta',
  kannada: 'kn',
  kn: 'kn',
  malayalam: 'ml',
  ml: 'ml',
  marathi: 'mr',
  mr: 'mr',
  bengali: 'bn',
  bn: 'bn',
});

function matchCategory(text, originalText = null) {
  const raw = String(originalText || text || '').trim();
  const t = normalizeText(text);

  // Never treat explicit handoff as foundation.
  if (isExplicitHumanHandoffRequest(t || raw, raw)) return null;

  // Empty / whitespace / emoji-only / punctuation-only → gentle clarification
  if (!raw || EMPTY_OR_EMOJI_RE.test(raw) || PUNCT_ONLY_RE.test(raw)) {
    return { category: CATEGORY.CLARIFICATION, topic: 'default' };
  }

  for (const candidate of intentTextCandidates(t, raw)) {
    if (!candidate) continue;

    if (
      GREETING_RE.test(candidate) ||
      TIME_GREETING_RE.test(candidate) ||
      NATIVE_GREETING_RE.test(raw) ||
      MIXED_GREETING_RE.test(raw) ||
      MIXED_GREETING_RE.test(candidate)
    ) {
      return { category: CATEGORY.GREETING };
    }

    if (IDENTITY_RE.test(candidate)) {
      return { category: CATEGORY.IDENTITY };
    }

    if (CAPABILITY_RE.test(candidate)) {
      return { category: CATEGORY.CAPABILITY };
    }

    if (NAVIGATION_RE.test(candidate)) {
      return { category: CATEGORY.NAVIGATION };
    }

    if (GRATITUDE_RE.test(candidate)) {
      return { category: CATEGORY.GRATITUDE };
    }

    if (GOODBYE_RE.test(candidate)) {
      return { category: CATEGORY.GOODBYE };
    }

    if (SMALL_TALK_RE.test(candidate)) {
      return { category: CATEGORY.SMALL_TALK };
    }

    if (LANGUAGE_SWITCH_RE.test(candidate) || LANGUAGE_SWITCH_RE.test(raw)) {
      const lang = resolveLanguageFromMessage(candidate) || resolveLanguageFromMessage(raw);
      if (lang) return { category: CATEGORY.LANGUAGE_SWITCH, language: lang };
    }

    for (const row of CLARIFICATION_MAP) {
      if (row.re.test(candidate) || row.re.test(raw)) {
        return { category: CATEGORY.CLARIFICATION, topic: row.topic };
      }
    }
  }

  return null;
}

function resolveLanguageFromMessage(text) {
  const lower = String(text || '').toLowerCase();
  for (const [alias, code] of Object.entries(LANG_ALIAS)) {
    if (lower.includes(alias.toLowerCase()) || String(text || '').includes(alias)) {
      const normalized = normalizeLanguageCode(code);
      if (isSupportedLanguage(normalized)) return normalized;
    }
  }
  return null;
}

/**
 * @returns {{
 *   handled: boolean,
 *   category?: string,
 *   replyText?: string,
 *   nextState?: string,
 *   clearSubflows?: boolean,
 *   preferredLanguage?: string|null,
 *   intent?: string,
 * } | null}
 */
function tryFoundationConversation({
  text,
  originalText = null,
  menuText = null,
} = {}) {
  const started = process.hrtime.bigint();
  const match = matchCategory(text, originalText);
  if (!match) {
    return null;
  }

  let replyText = FOUNDATION_REPLIES[match.category] || '';
  let nextState = 'idle';
  let clearSubflows = false;
  let preferredLanguage = null;
  let intent = `foundation_${match.category}`;

  switch (match.category) {
    case CATEGORY.GREETING:
      replyText = FOUNDATION_REPLIES.greeting;
      nextState = 'idle';
      break;
    case CATEGORY.IDENTITY:
      replyText = FOUNDATION_REPLIES.identity;
      break;
    case CATEGORY.CAPABILITY:
      replyText = FOUNDATION_REPLIES.capability;
      break;
    case CATEGORY.NAVIGATION:
      replyText = menuText || FOUNDATION_REPLIES.capability;
      nextState = 'main_menu';
      clearSubflows = true;
      intent = 'main_menu';
      break;
    case CATEGORY.GRATITUDE:
      replyText = FOUNDATION_REPLIES.gratitude;
      // Stay wherever we are — orchestrator should not clear guided state
      nextState = null;
      break;
    case CATEGORY.GOODBYE:
      replyText = FOUNDATION_REPLIES.goodbye;
      nextState = 'idle';
      clearSubflows = true;
      break;
    case CATEGORY.SMALL_TALK:
      replyText = FOUNDATION_REPLIES.small_talk;
      break;
    case CATEGORY.LANGUAGE_SWITCH:
      preferredLanguage = match.language;
      replyText = `Sure — I'll continue in that language.\n\nHow can I help you with admissions or counselling?`;
      break;
    case CATEGORY.CLARIFICATION:
      replyText =
        CLARIFICATION_BY_TOPIC[match.topic] || CLARIFICATION_BY_TOPIC.default;
      break;
    default:
      return null;
  }

  const elapsedNs = process.hrtime.bigint() - started;
  const durationMs = Number(elapsedNs) / 1e6;

  return {
    handled: true,
    category: match.category,
    replyText,
    nextState,
    clearSubflows,
    preferredLanguage,
    intent,
    durationMs,
  };
}

module.exports = {
  CATEGORY,
  matchCategory,
  tryFoundationConversation,
  resolveLanguageFromMessage,
};
