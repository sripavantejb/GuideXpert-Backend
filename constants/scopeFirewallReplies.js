'use strict';

const { normalizeLanguageCode } = require('./languageConstants');

const SCOPE_FIREWALL_REPLIES = {
  en:
    "I'm GuideXpert's counselling assistant.\n\n" +
    'I can help with IIT counselling, ranks, branches, admissions, fees, scholarships and GuideXpert services.\n\n' +
    'I currently cannot assist with programming, coding, image generation, movies, weather or unrelated topics.\n\n' +
    'Reply MENU to explore available options.',
  te:
    'నేను GuideXpert కౌన్సెలింగ్ అసిస్టెంట్‌ని.\n\n' +
    'IIT కౌన్సెలింగ్, ర్యాంకులు, బ్రాంచ్‌లు, అడ్మిషన్లు, ఫీజులు, స్కాలర్‌షిప్‌లు మరియు GuideXpert సేవల గురించి సహాయం చేయగలను.\n\n' +
    'ప్రోగ్రామింగ్, కోడింగ్, ఇమేజ్ జనరేషన్, సినిమాలు, వాతావరణం లేదా సంబంధం లేని అంశాలలో నేను ప్రస్తుతం సహాయం చేయలేను.\n\n' +
    'అందుబాటులో ఉన్న ఎంపికల కోసం MENU అని రిప్లై చేయండి.',
  hi:
    'Main GuideXpert ka counselling assistant hoon.\n\n' +
    'Main IIT counselling, ranks, branches, admissions, fees, scholarships aur GuideXpert services mein madad kar sakta hoon.\n\n' +
    'Main filhaal programming, coding, image generation, movies, weather ya asambandhit vishayon mein madad nahin kar sakta.\n\n' +
    'Vikalpon ke liye MENU likhein.',
  ta:
    'நான் GuideXpert-இன் counselling assistant.\n\n' +
    'IIT counselling, ranks, branches, admissions, fees, scholarships மற்றும் GuideXpert services-ல் உதவ முடியும்.\n\n' +
    'programming, coding, image generation, movies, weather அல்லது தொடர்பில்லாத topics-ல் தற்போது உதவ முடியாது.\n\n' +
    'விருப்பங்களுக்கு MENU என reply செய்யுங்கள்.',
  kn:
    'ನಾನು GuideXpert ನ counselling assistant.\n\n' +
    'IIT counselling, ranks, branches, admissions, fees, scholarships ಮತ್ತು GuideXpert services ನಲ್ಲಿ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ.\n\n' +
    'programming, coding, image generation, movies, weather ಅಥವಾ ಸಂಬಂಧವಿಲ್ಲದ topics ನಲ್ಲಿ ಸದ್ಯಕ್ಕೆ ಸಹಾಯ ಮಾಡಲಾಗದು.\n\n' +
    'ಆಯ್ಕೆಗಳಿಗಾಗಿ MENU ಎಂದು reply ಮಾಡಿ.',
  ml:
    'ഞാൻ GuideXpert ന്റെ counselling assistant ആണ്.\n\n' +
    'IIT counselling, ranks, branches, admissions, fees, scholarships, GuideXpert services എന്നിവയിൽ സഹായിക്കാം.\n\n' +
    'programming, coding, image generation, movies, weather അല്ലെങ്കിൽ ബന്ധമില്ലാത്ത topics-ൽ ഇപ്പോൾ സഹായിക്കാനാകില്ല.\n\n' +
    'options-നayi MENU എന്ന് reply ചെയ്യുക.',
  mr:
    'Mi GuideXpert cha counselling assistant aahe.\n\n' +
    'Mi IIT counselling, ranks, branches, admissions, fees, scholarships ani GuideXpert services madhe madat karu shakto.\n\n' +
    'Mi sadhya programming, coding, image generation, movies, weather kiva asambandhit vishayanmadhe madat karu shakat nahi.\n\n' +
    'Paryayansathi MENU lihaa.',
  bn:
    'Ami GuideXpert-er counselling assistant.\n\n' +
    'Ami IIT counselling, ranks, branches, admissions, fees, scholarships ebong GuideXpert services-e sahajya korte pari.\n\n' +
    'Ami ekhon programming, coding, image generation, movies, weather ba osamparkito bishoye sahajya korte pari na.\n\n' +
    'Bikolper jonno MENU likhun.',
};

const POLICY_REFUSAL_EN = {
  medical:
    'I cannot provide medical advice. Please consult a qualified doctor or healthcare professional.',
  legal:
    'I cannot provide legal advice. Please consult a qualified legal professional.',
  adult:
    'I cannot assist with adult or explicit content.',
  religion:
    'I focus on IIT counselling and college admissions. I cannot provide religious guidance.',
  current_affairs:
    'I focus on IIT counselling and college admissions. I cannot discuss news or current affairs.',
  math:
    'I cannot help with math homework or calculation problems. I focus on IIT counselling and admissions.',
  prompt_injection:
    "I'm GuideXpert's counselling assistant and can only help with IIT counselling, admissions and related topics.",
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

function resolvePolicyRefusal(category, resolvedLanguage = 'en') {
  void resolvedLanguage;
  return POLICY_REFUSAL_EN[category] || resolveScopeFirewallReply(resolvedLanguage);
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
  const blockedDesc = describeBlockedCategories(blockedSegments);
  const suffix = `I cannot assist with ${blockedDesc}. I focus on IIT counselling, ranks, branches, admissions, fees and GuideXpert services.`;
  if (!answer) return suffix;
  return `${answer}\n\n${suffix}`;
}

module.exports = {
  SCOPE_FIREWALL_REPLIES,
  POLICY_REFUSAL_EN,
  resolveScopeFirewallReply,
  resolvePolicyRefusal,
  buildPartialScopeReply,
  describeBlockedCategories,
};
