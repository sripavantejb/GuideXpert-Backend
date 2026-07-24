'use strict';

const mongoose = require('mongoose');
const WhatsAppConversation = require('../../models/WhatsAppConversation');
const { normalizeLanguageCode, isSupportedLanguage } = require('../../constants/languageConstants');
const { isRomanizedTeluguSocialGreeting } = require('../chatbot/intentClassifierService');

const DEFAULT_LANGUAGE = 'en';

const EXPLICIT_ENGLISH_MENU_GREETING_PATTERN =
  /^(hi|hello|hey|hola|start|menu|help)$/i;

const AMBIGUOUS_ACK_PATTERN =
  /^(ok|okay|k|yes|yeah|yep|yup|no|nope|fine|thanks|thank you|thx|cool|sure|got it|👍|🙏|👌)\s*[.!?]?$/i;

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

function getMinConfidence() {
  return Number(process.env.LANGUAGE_DETECT_MIN_CONFIDENCE) || 0.75;
}

function getStreakThreshold() {
  return Number(process.env.LANGUAGE_PREFERENCE_STREAK_THRESHOLD) || 3;
}

/**
 * Standalone English menu/greeting triggers — explicit language switch to English.
 */
function isExplicitEnglishMenuGreeting(message) {
  return EXPLICIT_ENGLISH_MENU_GREETING_PATTERN.test(String(message || '').trim());
}

/**
 * Short acknowledgements / menu taps — not language signals (Rule 2).
 */
function isAmbiguousMessage(message) {
  const text = String(message || '').trim();
  if (!text) return true;
  if (isExplicitEnglishMenuGreeting(text)) return false;
  if (AMBIGUOUS_ACK_PATTERN.test(text)) return true;
  if (/^[1-6]$/.test(text)) return true;
  if (text.length <= 2 && /^[\x00-\x7F]+$/u.test(text)) return true;
  if (/^[\u{1F300}-\u{1FAFF}\s]+$/u.test(text) && text.length <= 8) return true;
  return false;
}

const SHORT_CPA_FOLLOWUP_PATTERN =
  /^(fees?|fee|price|pricing|cost|benefits?|duration|mentorship|sessions?)\s*[.!?]?$/i;

function isShortCpaFollowUp(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (SHORT_CPA_FOLLOWUP_PATTERN.test(text)) return true;
  return /\b(fees kya hai|price kya hai|benefits kya hai|fees enti|benefits enti)\b/i.test(text);
}

const SHORT_IIT_COUNSELLING_FOLLOWUP_PATTERN =
  /^(rounds?|float|slide|freeze|quota)\s*[.!?]?$/i;

function isShortIitCounsellingFollowUp(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (SHORT_IIT_COUNSELLING_FOLLOWUP_PATTERN.test(text)) return true;
  return /\b(how many rounds|what is float|what is slide|what is freeze|rounds kitne|float ante enti|slide ante enti)\b/i.test(
    text
  );
}

function isShortIitCounsellingStrategyFollowUp(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  if (/^(placements?|coding|branch|college)\s*[.!?]?$/i.test(text)) return true;
  return (
    /\b(placements?|coding|better|safer|useful|prefer|branch|college|nachite|leda|ya|pasand)\b/i.test(text) ||
    /\bwhat if i\b/i.test(text) ||
    /\bwhich (has|is)\b/i.test(text) ||
    /\bcoding\s+nachite\b/i.test(text) ||
    /\bbranch kaun sa better\b/i.test(text)
  );
}

function resolveIitCounsellingStrategySessionAwareLanguage({
  conversation,
  leadContext,
  detected = {},
  message = '',
  sessionLanguage = null,
} = {}) {
  const session = normalizeLanguageCode(sessionLanguage);
  if (!session || session === DEFAULT_LANGUAGE || !isSupportedLanguage(session)) {
    return resolveConversationLanguage(conversation, leadContext, detected, message);
  }

  if (isExplicitEnglishMenuGreeting(message)) {
    return resolveConversationLanguage(conversation, leadContext, detected, message);
  }

  if (isRomanizedTeluguSocialGreeting(message)) {
    return resolveConversationLanguage(conversation, leadContext, detected, message);
  }

  const detectedLang = normalizeLanguageCode(detected.language);
  const confidence = Number(detected.confidence) || 0;
  const minConfidence = getMinConfidence();
  if (
    detectedLang &&
    detectedLang !== DEFAULT_LANGUAGE &&
    isSupportedLanguage(detectedLang) &&
    confidence >= minConfidence &&
    detectedLang !== session
  ) {
    return {
      language: detectedLang,
      source: 'iit_counselling_strategy_session',
      resolutionReason: 'iit_counselling_strategy_language_detected',
    };
  }

  if (isShortIitCounsellingStrategyFollowUp(message) || isAmbiguousMessage(message)) {
    return {
      language: session,
      source: 'iit_counselling_strategy_session',
      resolutionReason: 'iit_counselling_strategy_session_language',
    };
  }

  const base = resolveConversationLanguage(conversation, leadContext, detected, message);
  if (
    base.resolutionReason === 'explicit_english_greeting' ||
    base.resolutionReason === 'explicit_telugu_greeting'
  ) {
    return base;
  }

  if (base.language === DEFAULT_LANGUAGE && base.resolutionReason === 'high_confidence_detection') {
    return {
      language: session,
      source: 'iit_counselling_strategy_session',
      resolutionReason: 'iit_counselling_strategy_session_language',
    };
  }

  return base;
}

function resolveIitCounsellingSessionAwareLanguage({
  conversation,
  leadContext,
  detected = {},
  message = '',
  sessionLanguage = null,
} = {}) {
  const session = normalizeLanguageCode(sessionLanguage);
  if (!session || session === DEFAULT_LANGUAGE || !isSupportedLanguage(session)) {
    return resolveConversationLanguage(conversation, leadContext, detected, message);
  }

  if (isExplicitEnglishMenuGreeting(message)) {
    return resolveConversationLanguage(conversation, leadContext, detected, message);
  }

  if (isRomanizedTeluguSocialGreeting(message)) {
    return resolveConversationLanguage(conversation, leadContext, detected, message);
  }

  if (isShortIitCounsellingFollowUp(message) || isAmbiguousMessage(message)) {
    return {
      language: session,
      source: 'iit_counselling_session',
      resolutionReason: 'iit_counselling_session_language',
    };
  }

  const base = resolveConversationLanguage(conversation, leadContext, detected, message);
  if (
    base.resolutionReason === 'explicit_english_greeting' ||
    base.resolutionReason === 'explicit_telugu_greeting'
  ) {
    return base;
  }

  if (base.language === DEFAULT_LANGUAGE && base.resolutionReason === 'high_confidence_detection') {
    return {
      language: session,
      source: 'iit_counselling_session',
      resolutionReason: 'iit_counselling_session_language',
    };
  }

  return base;
}

function resolveSessionAwareLanguage({
  conversation,
  leadContext,
  detected = {},
  message = '',
  sessionLanguage = null,
} = {}) {
  const session = normalizeLanguageCode(sessionLanguage);
  if (!session || session === DEFAULT_LANGUAGE || !isSupportedLanguage(session)) {
    return resolveConversationLanguage(conversation, leadContext, detected, message);
  }

  if (isExplicitEnglishMenuGreeting(message)) {
    return resolveConversationLanguage(conversation, leadContext, detected, message);
  }

  if (isRomanizedTeluguSocialGreeting(message)) {
    return resolveConversationLanguage(conversation, leadContext, detected, message);
  }

  if (isShortCpaFollowUp(message) || isAmbiguousMessage(message)) {
    return {
      language: session,
      source: 'cpa_session',
      resolutionReason: 'cpa_session_language',
    };
  }

  const base = resolveConversationLanguage(conversation, leadContext, detected, message);
  if (
    base.resolutionReason === 'explicit_english_greeting' ||
    base.resolutionReason === 'explicit_telugu_greeting'
  ) {
    return base;
  }

  if (base.language === DEFAULT_LANGUAGE && base.resolutionReason === 'high_confidence_detection') {
    return {
      language: session,
      source: 'cpa_session',
      resolutionReason: 'cpa_session_language',
    };
  }

  return base;
}

function readStoredPreference(conversation, leadContext) {
  const stored = normalizeLanguageCode(conversation?.preferredLanguage);
  if (conversation?.preferredLanguage && isSupportedLanguage(stored) && stored !== DEFAULT_LANGUAGE) {
    return { language: stored, source: 'conversation' };
  }

  const fromLead = normalizeLanguageCode(leadContext?.iit?.preferredLanguage);
  if (fromLead && fromLead !== DEFAULT_LANGUAGE && isSupportedLanguage(fromLead)) {
    return { language: fromLead, source: 'iit_lead' };
  }

  return null;
}

function resolveConversationLanguage(conversation, leadContext, detected = {}, message = '') {
  const detectedLanguage = normalizeLanguageCode(detected.language);
  const confidence = Number(detected.confidence) || 0;
  const minConfidence = getMinConfidence();

  if (isExplicitEnglishMenuGreeting(message)) {
    return {
      language: DEFAULT_LANGUAGE,
      source: 'message',
      resolutionReason: 'explicit_english_greeting',
    };
  }

  if (isRomanizedTeluguSocialGreeting(message)) {
    return {
      language: 'te',
      source: 'message',
      resolutionReason: 'explicit_telugu_greeting',
    };
  }

  // Rule 1 & 3: high-confidence detection always wins (including English).
  if (isSupportedLanguage(detectedLanguage) && confidence >= minConfidence) {
    return {
      language: detectedLanguage,
      source: 'detection',
      resolutionReason: 'high_confidence_detection',
    };
  }

  // Rule 2: ambiguous messages may use conversation / lead memory.
  if (isAmbiguousMessage(message)) {
    const memory = readStoredPreference(conversation, leadContext);
    if (memory) {
      return {
        language: memory.language,
        source: memory.source,
        resolutionReason: 'ambiguous_message_memory',
      };
    }
    return {
      language: DEFAULT_LANGUAGE,
      source: 'fallback',
      resolutionReason: 'ambiguous_message_memory',
    };
  }

  const memory = readStoredPreference(conversation, leadContext);
  if (memory) {
    return {
      language: memory.language,
      source: memory.source,
      resolutionReason: 'low_confidence_fallback',
    };
  }

  if (isSupportedLanguage(detectedLanguage) && detectedLanguage !== DEFAULT_LANGUAGE) {
    return {
      language: detectedLanguage,
      source: 'detection',
      resolutionReason: 'low_confidence_detection',
    };
  }

  return {
    language: DEFAULT_LANGUAGE,
    source: 'fallback',
    resolutionReason: 'fallback',
  };
}

async function updatePreferredLanguage(conversationId, language) {
  const code = normalizeLanguageCode(language);
  if (!conversationId || !isSupportedLanguage(code) || !isDbReady()) return null;

  await WhatsAppConversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        preferredLanguage: code,
        updatedAt: new Date(),
      },
    }
  );
  return code;
}

async function seedPreferredLanguageFromLead(conversationId, leadContext) {
  if (!conversationId || !isDbReady()) return null;
  const conversation = await WhatsAppConversation.findById(conversationId).lean();
  if (!conversation) return null;

  const current = normalizeLanguageCode(conversation.preferredLanguage);
  if (conversation.preferredLanguage && current !== DEFAULT_LANGUAGE) {
    return current;
  }

  const fromLead = normalizeLanguageCode(leadContext?.iit?.preferredLanguage);
  if (!fromLead || fromLead === DEFAULT_LANGUAGE) return null;

  await updatePreferredLanguage(conversationId, fromLead);
  return fromLead;
}

async function recordDetectedLanguage(conversationId, detectedLanguage, confidence = 0) {
  if (!conversationId || !isDbReady()) return;

  const code = normalizeLanguageCode(detectedLanguage);
  if (!isSupportedLanguage(code)) return;

  const minConfidence = getMinConfidence();
  if (Number(confidence) < minConfidence) return;

  const conversation = await WhatsAppConversation.findById(conversationId).lean();
  if (!conversation) return;

  if (code === DEFAULT_LANGUAGE) {
    await WhatsAppConversation.updateOne(
      { _id: conversationId },
      {
        $set: {
          preferredLanguage: DEFAULT_LANGUAGE,
          updatedAt: new Date(),
          'metadata.langDetectStreakLang': null,
          'metadata.langDetectStreakCount': 0,
        },
      }
    );
    return;
  }

  const metadata = conversation.metadata || {};
  const streakLang = metadata.langDetectStreakLang || null;
  const streakCount = Number(metadata.langDetectStreakCount) || 0;
  const nextCount = streakLang === code ? streakCount + 1 : 1;

  const updates = {
    updatedAt: new Date(),
    'metadata.langDetectStreakLang': code,
    'metadata.langDetectStreakCount': nextCount,
  };

  if (nextCount >= getStreakThreshold()) {
    updates.preferredLanguage = code;
  }

  await WhatsAppConversation.updateOne({ _id: conversationId }, { $set: updates });
}

module.exports = {
  resolveConversationLanguage,
  resolveSessionAwareLanguage,
  isAmbiguousMessage,
  isShortCpaFollowUp,
  isShortIitCounsellingFollowUp,
  isShortIitCounsellingStrategyFollowUp,
  resolveIitCounsellingSessionAwareLanguage,
  resolveIitCounsellingStrategySessionAwareLanguage,
  isExplicitEnglishMenuGreeting,
  updatePreferredLanguage,
  seedPreferredLanguageFromLead,
  recordDetectedLanguage,
  getStreakThreshold,
};
