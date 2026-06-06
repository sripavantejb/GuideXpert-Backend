'use strict';

const mongoose = require('mongoose');
const KnowledgeAssistantLanguageLog = require('../../models/KnowledgeAssistantLanguageLog');
const { logChatbotEvent } = require('./chatbotStructuredLog');
const { aiDebugLog } = require('./aiDebugLog');
const { isMultilingualEnabled } = require('../../middleware/multilingualMiddleware');

function buildLanguageLogPayload(fields = {}) {
  return {
    originalMessage: fields.originalMessage ?? null,
    detectedLanguage: fields.detectedLanguage ?? null,
    resolvedLanguage: fields.resolvedLanguage ?? null,
    translatedQuery: fields.translatedQuery ?? null,
    englishResponse: fields.englishResponse ?? null,
    finalResponse: fields.finalResponse ?? null,
    translationApplied: fields.translationApplied ?? null,
    guardrailModified: fields.guardrailModified ?? null,
    retrievalMode: fields.retrievalMode ?? null,
    resultIds: fields.resultIds ?? null,
  };
}

function logKnowledgeAssistantLanguageDebug(fields = {}) {
  aiDebugLog('LANG', 'assistant turn', buildLanguageLogPayload(fields));
}

function logKnowledgeAssistantStructured(fields = {}) {
  if (!isMultilingualEnabled()) return;
  logChatbotEvent('knowledge_assistant_language', {
    conversationId: fields.conversationId,
    ...buildLanguageLogPayload(fields),
  });
}

async function persistKnowledgeAssistantLanguageLog(fields = {}) {
  if (!isMultilingualEnabled() || !fields.conversationId) return;
  if (mongoose.connection.readyState !== 1) return;

  try {
    await KnowledgeAssistantLanguageLog.create({
      conversationId: fields.conversationId,
      originalMessage: String(fields.originalMessage || ''),
      detectedLanguage: fields.detectedLanguage || 'en',
      resolvedLanguage: fields.resolvedLanguage || 'en',
      translatedQuery: String(fields.translatedQuery || ''),
      englishResponse: String(fields.englishResponse || ''),
      finalResponse: String(fields.finalResponse || ''),
      translationApplied: Boolean(fields.translationApplied),
      guardrailModified: Boolean(fields.guardrailModified),
      retrievalMode: fields.retrievalMode || null,
      resultIds: Array.isArray(fields.resultIds) ? fields.resultIds : [],
    });
  } catch (e) {
    console.warn('[chatbot] knowledge assistant language log persist failed', e.message);
  }
}

async function recordKnowledgeAssistantLanguageTurn(fields = {}) {
  logKnowledgeAssistantLanguageDebug(fields);
  logKnowledgeAssistantStructured(fields);
  await persistKnowledgeAssistantLanguageLog(fields);
}

module.exports = {
  buildLanguageLogPayload,
  logKnowledgeAssistantLanguageDebug,
  logKnowledgeAssistantStructured,
  persistKnowledgeAssistantLanguageLog,
  recordKnowledgeAssistantLanguageTurn,
};
