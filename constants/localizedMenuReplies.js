'use strict';

const { normalizeLanguageCode } = require('./languageConstants');
const { extractFirstName } = require('../services/chatbot/welcomeMessageService');

function salutation(lang, firstName) {
  const name = firstName || null;
  const map = {
    en: name ? `Hi ${name}!` : 'Hi there!',
    te: name ? `హాయ్ ${name}!` : 'హాయ్!',
    hi: name ? `नमस्ते ${name}!` : 'नमस्ते!',
    ta: name ? `வணக்கம் ${name}!` : 'வணக்கம்!',
    kn: name ? `ನಮಸ್ಕಾರ ${name}!` : 'ನಮಸ್ಕಾರ!',
    ml: name ? `നമസ്കാരം ${name}!` : 'നമസ്കാരം!',
    mr: name ? `नमस्कार ${name}!` : 'नमस्कार!',
    bn: name ? `নমস্কার ${name}!` : 'নমস্কার!',
  };
  return map[lang] || map.en;
}

const IIT_MENU_BODIES = {
  en: [
    "We're here to support your IIT & Engineering counselling journey.",
    '',
    'What would you like help with today?',
    '',
    '1️⃣ My Counselling Details',
    '2️⃣ My Meeting Link',
    '3️⃣ My Assigned Expert',
    '4️⃣ Rank Predictor',
    '5️⃣ College Predictor',
    '6️⃣ Talk to My Counsellor',
    '',
    'Reply MENU anytime for this menu.',
  ],
  te: [
    'మీ IIT & Engineering counselling ప్రయాణానికి మేము సహాయం చేస్తున్నాము.',
    '',
    'ఈరోజు మీకు ఏ సహాయం కావాలి?',
    '',
    '1️⃣ నా Counselling వివరాలు',
    '2️⃣ నా Meeting Link',
    '3️⃣ నా Assigned Expert',
    '4️⃣ Rank Predictor',
    '5️⃣ College Predictor',
    '6️⃣ Counsellor తో మాట్లాడండి',
    '',
    'ఎప్పుడైనా MENU అని రిప్లై చేయండి.',
  ],
  hi: [
    'Hum aapki IIT & Engineering counselling journey mein madad ke liye yahan hain.',
    '',
    'Aaj aapko kis cheez mein madad chahiye?',
    '',
    '1️⃣ Meri Counselling Details',
    '2️⃣ Meri Meeting Link',
    '3️⃣ Mera Assigned Expert',
    '4️⃣ Rank Predictor',
    '5️⃣ College Predictor',
    '6️⃣ Counsellor se baat karein',
    '',
    'Kisi bhi samay MENU likhein.',
  ],
  ta: [
    'உங்கள் IIT & Engineering counselling பயணத்தில் உதவ நாங்கள் இங்கே இருக்கிறோம்.',
    '',
    'இன்று உங்களுக்கு என்ன உதவி வேண்டும்?',
    '',
    '1️⃣ என் Counselling விவரங்கள்',
    '2️⃣ என் Meeting Link',
    '3️⃣ என் Assigned Expert',
    '4️⃣ Rank Predictor',
    '5️⃣ College Predictor',
    '6️⃣ Counsellor உடன் பேசுங்கள்',
    '',
    'எப்போது வேண்டுமானாலும் MENU என்று reply செய்யுங்கள்.',
  ],
  kn: [
    'ನಿಮ್ಮ IIT & Engineering counselling ಪ್ರಯಾಣಕ್ಕೆ ನಾವು ಸಹಾಯ ಮಾಡಲು ಇಲ್ಲಿದ್ದೇವೆ.',
    '',
    'ಇಂದು ನಿಮಗೆ ಯಾವ ಸಹಾಯ ಬೇಕು?',
    '',
    '1️⃣ ನನ್ನ Counselling Details',
    '2️⃣ ನನ್ನ Meeting Link',
    '3️⃣ ನನ್ನ Assigned Expert',
    '4️⃣ Rank Predictor',
    '5️⃣ College Predictor',
    '6️⃣ Counsellor ಜೊತೆ ಮಾತನಾಡಿ',
    '',
    'ಯಾವಾಗ ಬೇಕಾದರೂ MENU ಎಂದು reply ಮಾಡಿ.',
  ],
  ml: [
    'നിങ്ങളുടെ IIT & Engineering counselling യാത്രയിൽ സഹായിക്കാൻ ഞങ്ങൾ ഇവിടെയുണ്ട്.',
    '',
    'ഇന്ന് നിങ്ങൾക്ക് എന്ത് സഹായം വേണം?',
    '',
    '1️⃣ എന്റെ Counselling Details',
    '2️⃣ എന്റെ Meeting Link',
    '3️⃣ എന്റെ Assigned Expert',
    '4️⃣ Rank Predictor',
    '5️⃣ College Predictor',
    '6️⃣ Counsellor-മായി സംസാരിക്കുക',
    '',
    'എപ്പോൾ വേണമെങ്കിലും MENU എന്ന് reply ചെയ്യുക.',
  ],
  mr: [
    'आम्ही तुमच्या IIT & Engineering counselling प्रवासात मदत करण्यासाठी येथे आहोत.',
    '',
    'आज तुम्हाला कशात मदत हवी आहे?',
    '',
    '1️⃣ माझे Counselling Details',
    '2️⃣ माझी Meeting Link',
    '3️⃣ माझा Assigned Expert',
    '4️⃣ Rank Predictor',
    '5️⃣ College Predictor',
    '6️⃣ Counsellor शी बोला',
    '',
    'कधीही MENU म्हणून reply करा.',
  ],
  bn: [
    'আমরা আপনার IIT & Engineering counselling যাত্রায় সাহায্য করতে এখানে আছি।',
    '',
    'আজ আপনি কী সাহায্য চান?',
    '',
    '1️⃣ আমার Counselling Details',
    '2️⃣ আমার Meeting Link',
    '3️⃣ আমার Assigned Expert',
    '4️⃣ Rank Predictor',
    '5️⃣ College Predictor',
    '6️⃣ Counsellor-এর সাথে কথা বলুন',
    '',
    'যেকোনো সময় MENU লিখে reply করুন.',
  ],
};

function buildLocalizedWelcomeMenu(resolvedLanguage, leadContext = {}) {
  const lang = normalizeLanguageCode(resolvedLanguage) || 'en';
  const line = leadContext?.productLine || 'unknown';
  if (line !== 'iit_counselling') {
    return null;
  }

  const firstName = extractFirstName(leadContext?.iit?.fullName);
  const body = IIT_MENU_BODIES[lang] || IIT_MENU_BODIES.en;
  return [salutation(lang, firstName), '', ...body].join('\n');
}

module.exports = {
  buildLocalizedWelcomeMenu,
  IIT_MENU_BODIES,
};
