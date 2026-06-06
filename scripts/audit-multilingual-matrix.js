#!/usr/bin/env node
'use strict';

const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { detectLanguage, setLanguageDetectionProvider } = require('../services/language/languageDetectionService');
const { resolveConversationLanguage } = require('../services/chatbot/conversationLanguageService');

const MESSAGES = [
  'Can I get CSE with rank 15000?',
  '15000 ర్యాంక్‌తో CSE వస్తుందా?',
  'నాకు ఏ బ్రాంచ్ మంచిది?',
  'naaku cse kavali',
  '15000 rank ki cse vastunda',
  'mujhe cse chahiye',
  'meri rank 15000 hai',
];

setLanguageDetectionProvider({
  chatCompletion: async () => {
    throw new Error('LLM detection disabled for audit script');
  },
});

async function auditMessage(message) {
  const detection = await detectLanguage({ message });
  const resolved = resolveConversationLanguage(null, null, detection);
  const englishMessage =
    resolved.language === 'en' ? message : `[translate-in:${resolved.language}] ${message}`;
  const intent = classifyIntent(
    resolved.language === 'en' ? message : englishMessage.replace(/^\[translate-in:[^\]]+\]\s*/, message),
    null,
    'iit_counselling'
  );

  return {
    originalMessage: message,
    detectedLanguage: detection.language,
    resolvedLanguage: resolved.language,
    source: detection.source,
    englishMessage,
    intent: intent.intent,
    intentConfidence: intent.confidence,
  };
}

async function main() {
  console.log('Phase 6 multilingual audit matrix\n');
  for (const message of MESSAGES) {
    const row = await auditMessage(message);
    console.log(JSON.stringify(row, null, 2));
    console.log('---');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
