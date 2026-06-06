'use strict';

const { normalizeLanguageCode } = require('./languageConstants');

const GREETING_REPLIES = {
  en: "I'm doing well. How can I help you today?",
  te: 'నేను బాగున్నాను. మీకు ఎలా సహాయం చేయగలను?',
  hi: 'मैं ठीक हूँ। मैं आपकी कैसे मदद कर सकता हूँ?',
  ta: 'நான் நன்றாக இருக்கிறேன். உங்களுக்கு எப்படி உதவலாம்?',
  kn: 'ನಾನು ಚೆನ್ನಾಗಿದ್ದೇನೆ. ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?',
  ml: 'ഞാൻ നന്നായിരിക്കുന്നു. എനിക്ക് നിങ്ങളെ എങ്ങനെ സഹായിക്കാനാകും?',
  mr: 'मी ठीक आहे. मी तुम्हाला कशी मदत करू शकतो?',
  bn: 'আমি ভালো আছি। আমি আপনাকে কীভাবে সাহায্য করতে পারি?',
};

function resolveGreetingReply(resolvedLanguage) {
  const code = normalizeLanguageCode(resolvedLanguage);
  return GREETING_REPLIES[code] || GREETING_REPLIES.en;
}

module.exports = {
  GREETING_REPLIES,
  resolveGreetingReply,
};
