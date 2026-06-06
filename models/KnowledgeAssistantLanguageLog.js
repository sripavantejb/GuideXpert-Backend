const mongoose = require('mongoose');
const { SUPPORTED_LANGUAGES } = require('../constants/languageConstants');

const knowledgeAssistantLanguageLogSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    originalMessage: { type: String, default: '' },
    detectedLanguage: { type: String, enum: SUPPORTED_LANGUAGES, default: 'en' },
    resolvedLanguage: { type: String, enum: SUPPORTED_LANGUAGES, default: 'en' },
    translatedQuery: { type: String, default: '' },
    englishResponse: { type: String, default: '' },
    finalResponse: { type: String, default: '' },
    translationApplied: { type: Boolean, default: false },
    guardrailModified: { type: Boolean, default: false },
    retrievalMode: { type: String, default: null },
    resultIds: { type: [String], default: [] },
  },
  { timestamps: true }
);

knowledgeAssistantLanguageLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

module.exports = mongoose.model(
  'KnowledgeAssistantLanguageLog',
  knowledgeAssistantLanguageLogSchema
);
