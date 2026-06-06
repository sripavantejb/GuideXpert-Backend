'use strict';

const SUPPORTED_LANGUAGES = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr', 'bn'];

const CRM_LABEL_TO_ISO = {
  english: 'en',
  en: 'en',
  telugu: 'te',
  te: 'te',
  hindi: 'hi',
  hi: 'hi',
  tamil: 'ta',
  ta: 'ta',
  kannada: 'kn',
  kn: 'kn',
  malayalam: 'ml',
  ml: 'ml',
  marathi: 'mr',
  mr: 'mr',
  bengali: 'bn',
  bn: 'bn',
  Telugu: 'te',
  Hindi: 'hi',
  Tamil: 'ta',
  Kannada: 'kn',
  Malayalam: 'ml',
  Marathi: 'mr',
  Bengali: 'bn',
  English: 'en',
};

const ISO_TO_CRM_LABEL = {
  en: 'English',
  te: 'Telugu',
  hi: 'Hindi',
  ta: 'Tamil',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  bn: 'Bengali',
};

/** ISO 639-3 (franc) → ISO 639-1 supported codes */
const FRANC_TO_ISO = {
  eng: 'en',
  tel: 'te',
  hin: 'hi',
  tam: 'ta',
  kan: 'kn',
  mal: 'ml',
  mar: 'mr',
  ben: 'bn',
};

function normalizeLanguageCode(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'en';
  const mapped = CRM_LABEL_TO_ISO[raw] || CRM_LABEL_TO_ISO[raw.toLowerCase()];
  if (mapped && isSupportedLanguage(mapped)) return mapped;
  const lower = raw.toLowerCase();
  if (isSupportedLanguage(lower)) return lower;
  return 'en';
}

function isSupportedLanguage(code) {
  return SUPPORTED_LANGUAGES.includes(String(code || '').toLowerCase());
}

function crmLabelFromIso(code) {
  return ISO_TO_CRM_LABEL[normalizeLanguageCode(code)] || 'English';
}

module.exports = {
  SUPPORTED_LANGUAGES,
  CRM_LABEL_TO_ISO,
  ISO_TO_CRM_LABEL,
  FRANC_TO_ISO,
  normalizeLanguageCode,
  isSupportedLanguage,
  crmLabelFromIso,
};
