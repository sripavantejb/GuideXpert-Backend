'use strict';

const LANGUAGE_CODES = ['en', 'te', 'hi', 'ta', 'kn', 'ml', 'mr', 'bn'];

const TRANSLATION_PROBE_MESSAGES = {
  en: 'How are you?',
  te: 'మీరు ఎలా ఉన్నారు?',
  hi: 'आप कैसे हैं?',
  ta: 'நீங்கள் எப்படி இருக்கிறீர்கள்?',
  kn: 'ನೀವು ಹೇಗಿದ್ದೀರಿ?',
  ml: 'നിങ്ങൾക്ക് സുഖമാണോ?',
  mr: 'तुम्ही कसे आहात?',
  bn: 'আপনি কেমন আছেন?',
};

const SAMPLE_ENGLISH_FOR_OUTBOUND = 'I am doing well. How can I help you today?';

/** Native-script probes for branch/rank/unknown (romanized ASCII often detects as English). */
const LANGUAGE_MATRIX = [
  {
    lang: 'en',
    greeting: 'How are you?',
    branch: 'Which branch is good for me?',
    rank: 'Can I get CSE with rank 15000?',
    unknown: 'What is GuideXpert?',
  },
  {
    lang: 'te',
    greeting: 'మీరు ఎలా ఉన్నారు?',
    branch: 'నాకు ఏ బ్రాంచ్ మంచిది?',
    rank: '15000 rank ki cse vastunda',
    unknown: 'విద్యార్థులకు కౌన్సిలింగ్ సేవ అంటే ఏమిటి?',
  },
  {
    lang: 'hi',
    greeting: 'आप कैसे हैं?',
    branch: 'mujhe kaun si branch chahiye?',
    rank: '15000 rank par CSE milega kya?',
    unknown: 'GuideXpert kya hai?',
  },
  {
    lang: 'ta',
    greeting: 'நீங்கள் எப்படி இருக்கிறீர்கள்?',
    branch: 'எனக்கு எந்த branch நல்லது?',
    rank: '15000 ரேங்கில் CSE கிடைக்குமா?',
    unknown: 'மாணவர்களுக்கு வழிகாட்டுதல் எப்படி வழங்கப்படுகிறது?',
  },
  {
    lang: 'kn',
    greeting: 'ನೀವು ಹೇಗಿದ್ದೀರಿ?',
    branch: 'ನನಗೆ ಯಾವ ಶಾಖೆ ಒಳ್ಳೆಯದು?',
    rank: '15000 ರ್ಯಾಂಕ್ನಲ್ಲಿ CSE ಸಿಗುತ್ತೆ?',
    unknown: 'ವಿದ್ಯಾರ್ಥಿಗಳಿಗೆ ಮಾರ್ಗದರ್ಶನ ಹೇಗೆ ಸಿಗುತ್ತದೆ?',
  },
  {
    lang: 'ml',
    greeting: 'നിങ്ങൾക്ക് സുഖമാണോ?',
    branch: 'എനിക്ക് ഏത് branch നല്ലത്?',
    rank: '15000 റാങ്കിൽ CSE കിട്ടുമോ?',
    unknown: 'വിദ്യാർത്ഥികൾക്ക് ഉപദേശം എങ്ങനെ ലഭിക്കും?',
  },
  {
    lang: 'mr',
    greeting: 'तुम्ही कसे आहात?',
    branch: 'मला कोणती शाखा चांगली?',
    rank: '15000 रँक वर CSE मिळेल का?',
    unknown: 'विद्यार्थ्यांना समुपदेशन कसे मिळते?',
  },
  {
    lang: 'bn',
    greeting: 'আপনি কেমন আছেন?',
    branch: 'আমার জন্য কোন branch ভালো?',
    rank: '15000 র‌্যাঙ্কে CSE পাব?',
    unknown: 'শিক্ষার্থীদের পরামর্শ কীভাবে দেওয়া হয়?',
  },
];

module.exports = {
  LANGUAGE_CODES,
  TRANSLATION_PROBE_MESSAGES,
  SAMPLE_ENGLISH_FOR_OUTBOUND,
  LANGUAGE_MATRIX,
};
