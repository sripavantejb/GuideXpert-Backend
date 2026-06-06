'use strict';

const { normalizeLanguageCode } = require('./languageConstants');
const {
  KNOWLEDGE_ASSISTANT_FALLBACK_REPLY,
  localizeKnownFallback,
} = require('./localizedFallbackStrings');

const SYSTEM_REPLIES = {
  orchestratorFallback: {
    en: 'Sorry, something went wrong on our side. Please try again in a moment or reply MENU for options.',
    te: 'క్షమించండి, మా వైపు ఏదో తప్పు జరిగింది. కొంత సమయం తర్వాత మళ్లీ ప్రయత్నించండి లేదా MENU అని రిప్లై చేయండి.',
    hi: 'Maaf kijiye, hamari taraf kuch galat ho gaya. Kripya thodi der baad phir koshish karein ya MENU likhein.',
    ta: 'மன்னிக்கவும், எங்கள் பக்கத்தில் பிழை ஏற்பட்டது. சிறிது நேரம் கழித்து மீண்டும் try செய்யுங்கள் அல்லது MENU என reply செய்யுங்கள்.',
    kn: 'ಕ್ಷಮಿಸಿ, ನಮ್ಮ ಬದಿಯಲ್ಲಿ ಏನೋ ತಪ್ಪಾಗಿದೆ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ MENU ಎಂದು reply ಮಾಡಿ.',
    ml: 'ക്ഷമിക്കുക, ഞങ്ങളുടെ വശത്ത് എന്തോ പിഴവ് സംഭവിച്ചു. കുറച്ച് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കുക അല്ലെങ്കിൽ MENU എന്ന് reply ചെയ്യുക.',
    mr: 'माफ करा, आमच्या बाजूने काहीतरी चूक झाली. थोड्या वेळाने पुन्हा प्रयत्न करा किंवा MENU म्हणून reply करा.',
    bn: 'দুঃখিত, আমাদের পক্ষে কিছু ভুল হয়েছে। একটু পরে আবার চেষ্টা করুন বা MENU লিখে reply করুন.',
  },
  handoffWait: {
    en: 'Our counsellor team is handling your chat. Please wait for their reply here.\n\nReply MENU to return to the assistant.',
    te: 'మా counsellor team మీ chat ను handle చేస్తోంది. దయచేసి ఇక్కడ reply కోసం వేచి ఉండండి.\n\nMENU అని రిప్లై చేయండి.',
    hi: 'Hamari counsellor team aapki chat handle kar rahi hai. Kripya yahan reply ka intezaar karein.\n\nMENU likhein.',
    ta: 'எங்கள் counsellor team உங்கள் chat-ஐ handle செய்கிறது. இங்கே reply-க்காக காத்திருங்கள்.\n\nMENU என reply செய்யுங்கள்.',
    kn: 'ನಮ್ಮ counsellor team ನಿಮ್ಮ chat handle ಮಾಡುತ್ತಿದೆ. ದಯವಿಟ್ಟು ಇಲ್ಲಿ reply ಗಾಗಿ ಕಾಯಿರಿ.\n\nMENU ಎಂದು reply ಮಾಡಿ.',
    ml: 'ഞങ്ങളുടെ counsellor team നിങ്ങളുടെ chat handle ചെയ്യുന്നു. reply-ക്കായി ഇവിടെ കാത്തിരിക്കുക.\n\nMENU എന്ന് reply ചെയ്യുക.',
    mr: 'आमची counsellor team तुमचा chat handle करत आहे. कृपया reply साठी थांबा.\n\nMENU म्हणून reply करा.',
    bn: 'আমাদের counsellor team আপনার chat handle করছে। reply-এর জন্য অপেক্ষা করুন.\n\nMENU লিখে reply করুন.',
  },
  optOut: {
    en: 'You have been opted out of automated messages. Reply MENU anytime to start again.',
    te: 'మీరు automated messages నుండి opt out అయ్యారు. మళ్లీ ప్రారంభించడానికి MENU అని రిప్లై చేయండి.',
    hi: 'Aap automated messages se opt out ho gaye hain. Dobara shuru karne ke liye MENU likhein.',
    ta: 'Automated messages-லிருந்து opt out செய்துவிட்டீர்கள். மீண்டும் MENU என reply செய்யுங்கள்.',
    kn: 'Automated messages ನಿಂದ opt out ಆಗಿದ್ದೀರಿ. ಮತ್ತೆ MENU ಎಂದು reply ಮಾಡಿ.',
    ml: 'Automated messages-ൽ നിന്ന് opt out ചെയ്തു. വീണ്ടും MENU എന്ന് reply ചെയ്യുക.',
    mr: 'Automated messages मधून opt out झाला आहात. पुन्हा MENU म्हणून reply करा.',
    bn: 'Automated messages থেকে opt out হয়েছেন। আবার MENU লিখে reply করুন.',
  },
  faqPrompt: {
    en: 'Send a topic (e.g. "meeting link", "IIT session", "book demo") and I will search our FAQs.',
    te: 'ఒక topic పంపండి (ఉదా. "meeting link", "IIT session") మరియు నేను FAQs లో వెతుకుతాను.',
    hi: 'Ek topic bhejein (jaise "meeting link", "IIT session") aur main FAQs mein khojunga.',
    ta: 'ஒரு topic அனுப்புங்கள் (எ.கா. "meeting link") நான் FAQs-ல் தேடுவேன்.',
    kn: 'ಒಂದು topic ಕಳುಹಿಸಿ (ಉದಾ. "meeting link") ನಾನು FAQs ನಲ್ಲಿ ಹುಡುಕುತ್ತೇನೆ.',
    ml: 'ഒരു topic അയയ്ക്കുക (ഉദാ. "meeting link") ഞാൻ FAQs-ൽ തിരയും.',
    mr: 'एक topic पाठवा (उदा. "meeting link") मी FAQs मध्ये शोधेन.',
    bn: 'একটি topic পাঠান (যেমন "meeting link") আমি FAQs-এ খুঁজব।',
  },
};

function resolveSystemReply(key, resolvedLanguage) {
  const lang = normalizeLanguageCode(resolvedLanguage) || 'en';
  const map = SYSTEM_REPLIES[key] || {};
  return map[lang] || map.en || '';
}

function resolveKnowledgeAssistantFallback(resolvedLanguage) {
  return localizeKnownFallback(KNOWLEDGE_ASSISTANT_FALLBACK_REPLY, resolvedLanguage);
}

module.exports = {
  SYSTEM_REPLIES,
  resolveSystemReply,
  resolveKnowledgeAssistantFallback,
};
