'use strict';

const { normalizeLanguageCode } = require('./languageConstants');

const STANDARD_REFUSAL_EN =
  "I'm here to help only with GuideXpert services, admissions, IIT counselling, college selection, scholarships, eligibility, counselling sessions, and related topics. I can't assist with unrelated topics.";

const SCOPE_FIREWALL_REPLIES = {
  en: STANDARD_REFUSAL_EN,
  te:
    'నేను GuideXpert సేవలు, అడ్మిషన్లు, IIT కౌన్సెలింగ్, కాలేజీ ఎంపిక, స్కాలర్‌షిప్‌లు, అర్హత, కౌన్సెలింగ్ సెషన్లు మరియు సంబంధిత అంశాలలో మాత్రమే సహాయం చేయగలను. సంబంధం లేని అంశాలలో నేను సహాయం చేయలేను.',
  hi:
    'Main sirf GuideXpert services, admissions, IIT counselling, college selection, scholarships, eligibility, counselling sessions aur related topics mein madad kar sakta hoon. Main unrelated topics mein madad nahin kar sakta.',
  ta:
    'நான் GuideXpert services, admissions, IIT counselling, college selection, scholarships, eligibility, counselling sessions மற்றும் தொடர்புடைய topics-ல் மட்டுமே உதவ முடியும். தொடர்பில்லாத topics-ல் உதவ முடியாது.',
  kn:
    'ನಾನು GuideXpert services, admissions, IIT counselling, college selection, scholarships, eligibility, counselling sessions ಮತ್ತು ಸಂಬಂಧಿತ topics ನಲ್ಲಿ ಮಾತ್ರ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. ಸಂಬಂಧವಿಲ್ಲದ topics ನಲ್ಲಿ ಸಹಾಯ ಮಾಡಲಾಗದು.',
  ml:
    'ഞാൻ GuideXpert services, admissions, IIT counselling, college selection, scholarships, eligibility, counselling sessions, related topics എന്നിവയിൽ മാത്രം സഹായിക്കാം. ബന്ധമില്ലാത്ത topics-ൽ സഹായിക്കാനാകില്ല.',
  mr:
    'Mi GuideXpert services, admissions, IIT counselling, college selection, scholarships, eligibility, counselling sessions ani related topics madhech madat karu shakto. Asambandhit vishayanmadhe madat karu shakat nahi.',
  bn:
    'Ami shudhu GuideXpert services, admissions, IIT counselling, college selection, scholarships, eligibility, counselling sessions ebong related topics-e sahajya korte pari. Osamparkito bishoye sahajya korte pari na.',
};

const BLOCKED_CATEGORY_PHRASE_EN = {
  programming: 'programming or coding',
  image_generation: 'image generation',
  movies: 'movies or entertainment',
  weather: 'weather updates',
  sports: 'sports scores',
  politics: 'politics',
  finance: 'finance or crypto investing',
  prompt_injection: 'that request',
  general_trivia: 'unrelated topics',
};

function resolveScopeFirewallReply(resolvedLanguage) {
  const code = normalizeLanguageCode(resolvedLanguage);
  return SCOPE_FIREWALL_REPLIES[code] || SCOPE_FIREWALL_REPLIES.en;
}

function resolvePolicyRefusal(_category, resolvedLanguage = 'en') {
  return resolveScopeFirewallReply(resolvedLanguage);
}

function describeBlockedCategories(blockedSegments = []) {
  const categories = [...new Set(blockedSegments.map((s) => s.category).filter(Boolean))];
  const phrases = categories
    .map((c) => BLOCKED_CATEGORY_PHRASE_EN[c] || c.replace(/_/g, ' '))
    .filter(Boolean);
  if (phrases.length === 0) return 'unrelated topics';
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join(', ')} or ${phrases[phrases.length - 1]}`;
}

/**
 * Append scope refusal for blocked segments after a counselling LLM answer.
 */
function buildPartialScopeReply({ counsellingAnswer, blockedSegments, resolvedLanguage = 'en' }) {
  void resolvedLanguage;
  const answer = String(counsellingAnswer || '').trim();
  const suffix = resolveScopeFirewallReply('en');
  if (!answer) return suffix;
  return `${answer}\n\n${suffix}`;
}

module.exports = {
  STANDARD_REFUSAL_EN,
  SCOPE_FIREWALL_REPLIES,
  resolveScopeFirewallReply,
  resolvePolicyRefusal,
  buildPartialScopeReply,
  describeBlockedCategories,
};
