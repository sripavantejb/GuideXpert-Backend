'use strict';

const { normalizeLanguageCode } = require('./languageConstants');

const COLLEGE_PREDICTOR_RANK_QUERY_UNAVAILABLE = {
  en: [
    'You already provided your rank, so Rank Predictor is not needed.',
    '',
    'This query normally uses College Predictor.',
    '',
    'College Predictor is currently unavailable.',
    '',
    'Reply MENU for other options.',
  ].join('\n'),
  te: [
    'మీరు ఇప్పటికే మీ ర్యాంక్‌ను ఇచ్చారు, కాబట్టి Rank Predictor అవసరం లేదు.',
    '',
    'ఈ ప్రశ్న సాధారణంగా College Predictor ఉపయోగిస్తుంది.',
    '',
    'College Predictor ప్రస్తుతం అందుబాటులో లేదు.',
    '',
    'ఇతర ఎంపికల కోసం MENU అని రిప్లై చేయండి.',
  ].join('\n'),
  hi: [
    'आपने अपनी रैंक पहले ही दे दी है, इसलिए Rank Predictor की ज़रूरत नहीं है।',
    '',
    'यह प्रश्न सामान्यतः College Predictor से संभाला जाता है।',
    '',
    'College Predictor अभी उपलब्ध नहीं है।',
    '',
    'अन्य विकल्पों के लिए MENU लिखें।',
  ].join('\n'),
  ta: [
    'நீங்கள் ஏற்கனவே உங்கள் rank-ஐ வழங்கியுள்ளீர்கள், அதனால் Rank Predictor தேவையில்லை.',
    '',
    'இந்த கேள்வி வழக்கமாக College Predictor மூலம் கையாளப்படும்.',
    '',
    'College Predictor தற்போது கிடைக்கவில்லை.',
    '',
    'மற்ற விருப்பங்களுக்கு MENU என்று பதில் அனுப்புங்கள்.',
  ].join('\n'),
  kn: [
    'ನೀವು ಈಗಾಗಲೇ ನಿಮ್ಮ rank ಅನ್ನು ನೀಡಿದ್ದೀರಿ, ಆದ್ದರಿಂದ Rank Predictor ಅಗತ್ಯವಿಲ್ಲ.',
    '',
    'ಈ ಪ್ರಶ್ನೆಯನ್ನು ಸಾಮಾನ್ಯವಾಗಿ College Predictor ಬಳಸಿ ನಿಭಾಯಿಸಲಾಗುತ್ತದೆ.',
    '',
    'College Predictor ಪ್ರಸ್ತುತ ಲಭ್ಯವಿಲ್ಲ.',
    '',
    'ಇತರ ಆಯ್ಕೆಗಳಿಗಾಗಿ MENU ಎಂದು ಉತ್ತರಿಸಿ.',
  ].join('\n'),
  ml: [
    'നിങ്ങൾ ഇതിനകം നിങ്ങളുടെ rank നൽകിയിട്ടുണ്ട്, അതുകൊണ്ട് Rank Predictor ആവശ്യമില്ല.',
    '',
    'ഈ ചോദ്യം സാധാരണയായി College Predictor ഉപയോഗിച്ച് കൈകാര്യം ചെയ്യുന്നു.',
    '',
    'College Predictor ഇപ്പോൾ ലഭ്യമല്ല.',
    '',
    'മറ്റ് ഓപ്ഷനുകൾക്കായി MENU എന്ന് മറുപടി നൽകുക.',
  ].join('\n'),
  mr: [
    'तुम्ही आधीच तुमची rank दिली आहे, म्हणून Rank Predictorाची गरज नाही.',
    '',
    'हा प्रश्न सामान्यतः College Predictor वापरून हाताळला जातो.',
    '',
    'College Predictor सध्या उपलब्ध नाही.',
    '',
    'इतर पर्यायांसाठी MENU म्हणून उत्तर द्या.',
  ].join('\n'),
  bn: [
    'আপনি ইতিমধ্যে আপনার rank দিয়েছেন, তাই Rank Predictor-এর প্রয়োজন নেই।',
    '',
    'এই প্রশ্ন সাধারণত College Predictor দিয়ে পরিচালিত হয়।',
    '',
    'College Predictor এখন উপলব্ধ নয়।',
    '',
    'অন্যান্য বিকল্পের জন্য MENU লিখে উত্তর দিন।',
  ].join('\n'),
};

const COLLEGE_PREDICTOR_MAINTENANCE = {
  en: [
    'College predictions are temporarily unavailable (service is under maintenance).',
    '',
    'Please try again later.',
    '',
    'Reply MENU for other options.',
  ].join('\n'),
  te: [
    'College Predictor తాత్కాలికంగా అందుబాటులో లేదు (సేవ నిర్వహణలో ఉంది).',
    '',
    'దయచేసి తర్వాత మళ్లీ ప్రయత్నించండి.',
    '',
    'ఇతర ఎంపికల కోసం MENU అని రిప్లై చేయండి.',
  ].join('\n'),
  hi: [
    'College Predictor abhi asthayi roop se uplabdh nahin hai (service maintenance mein hai).',
    '',
    'Kripya baad mein phir koshish karein.',
    '',
    'Anya vikalpon ke liye MENU likhein.',
  ].join('\n'),
  ta: [
    'College Predictor thodarkalaaga kidaikkavillai (service maintenance-la irukku).',
    '',
    'Piragu matrum try seiyungal.',
    '',
    'Mattru vaaippugalukku MENU endru reply seiyungal.',
  ].join('\n'),
  kn: [
    'College Predictor sada labhyavilla (service maintenance nalli ide).',
    '',
    'Dayavittu nantara matthye prayatnisiri.',
    '',
    'Itara vikalpagaligagi MENU endu reply madi.',
  ].join('\n'),
  ml: [
    'College Predictor ippol labhyamalla (service maintenance-il aanu).',
    '',
    'Dayavayi pinneedu shramikkuka.',
    '',
    'Mattu vikalpangalukku MENU ennu reply cheyyuka.',
  ].join('\n'),
  mr: [
    'College Predictor sada upalabdh nahi (service maintenance madhye aahe).',
    '',
    'Kripaya nantar punha prayatna kara.',
    '',
    'Itar parayānsathi MENU mhanun reply kara.',
  ].join('\n'),
  bn: [
    'College Predictor ekhon upalabdhho nei (service maintenance-e ache).',
    '',
    'Por e abar try korun.',
    '',
    'Onno option-er jonno MENU likhe reply korun.',
  ].join('\n'),
};

function resolveCollegePredictorRankQueryUnavailableReply(resolvedLanguage) {
  const code = normalizeLanguageCode(resolvedLanguage);
  return COLLEGE_PREDICTOR_RANK_QUERY_UNAVAILABLE[code] || COLLEGE_PREDICTOR_RANK_QUERY_UNAVAILABLE.en;
}

function resolveCollegePredictorMaintenanceReply(resolvedLanguage) {
  const code = normalizeLanguageCode(resolvedLanguage);
  return COLLEGE_PREDICTOR_MAINTENANCE[code] || COLLEGE_PREDICTOR_MAINTENANCE.en;
}

module.exports = {
  COLLEGE_PREDICTOR_RANK_QUERY_UNAVAILABLE,
  COLLEGE_PREDICTOR_MAINTENANCE,
  resolveCollegePredictorRankQueryUnavailableReply,
  resolveCollegePredictorMaintenanceReply,
};
