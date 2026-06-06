'use strict';

const mongoose = require('mongoose');
const WhatsAppConversation = require('../../models/WhatsAppConversation');
const { normalizeLanguageCode, isSupportedLanguage } = require('../../constants/languageConstants');

const DEFAULT_LANGUAGE = 'en';
const PREFERENCE_STREAK_THRESHOLD = 2;

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

function resolveConversationLanguage(conversation, leadContext, detected = {}) {
  const stored = normalizeLanguageCode(conversation?.preferredLanguage);
  if (conversation?.preferredLanguage && isSupportedLanguage(stored) && stored !== DEFAULT_LANGUAGE) {
    return { language: stored, source: 'conversation' };
  }

  const iitLabel = leadContext?.iit?.preferredLanguage;
  if (iitLabel) {
    const fromLead = normalizeLanguageCode(iitLabel);
    if (isSupportedLanguage(fromLead) && fromLead !== DEFAULT_LANGUAGE) {
      return { language: fromLead, source: 'iit_lead' };
    }
  }

  const detectedLanguage = normalizeLanguageCode(detected.language);
  const confidence = Number(detected.confidence) || 0;
  const minConfidence = Number(process.env.LANGUAGE_DETECT_MIN_CONFIDENCE) || 0.75;
  if (
    isSupportedLanguage(detectedLanguage) &&
    detectedLanguage !== DEFAULT_LANGUAGE &&
    confidence >= minConfidence
  ) {
    return { language: detectedLanguage, source: 'detection' };
  }

  return { language: DEFAULT_LANGUAGE, source: 'fallback' };
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
  if (!isSupportedLanguage(code) || code === DEFAULT_LANGUAGE) return;

  const minConfidence = Number(process.env.LANGUAGE_DETECT_MIN_CONFIDENCE) || 0.75;
  if (Number(confidence) < minConfidence) return;

  const conversation = await WhatsAppConversation.findById(conversationId).lean();
  if (!conversation) return;

  const metadata = conversation.metadata || {};
  const streakLang = metadata.langDetectStreakLang || null;
  const streakCount = Number(metadata.langDetectStreakCount) || 0;
  const nextCount = streakLang === code ? streakCount + 1 : 1;

  const updates = {
    updatedAt: new Date(),
    'metadata.langDetectStreakLang': code,
    'metadata.langDetectStreakCount': nextCount,
  };

  if (nextCount >= PREFERENCE_STREAK_THRESHOLD) {
    updates.preferredLanguage = code;
  }

  await WhatsAppConversation.updateOne({ _id: conversationId }, { $set: updates });
}

module.exports = {
  resolveConversationLanguage,
  updatePreferredLanguage,
  seedPreferredLanguageFromLead,
  recordDetectedLanguage,
};
