'use strict';

const { normalizeLanguageCode } = require('./languageConstants');
const { extractFirstName } = require('../services/chatbot/welcomeMessageService');

function buildLocalizedCounsellingSupportReply(resolvedLanguage, leadContext = {}, opts = {}) {
  const lang = normalizeLanguageCode(resolvedLanguage) || 'en';
  const i = leadContext?.iit || {};
  const firstName = extractFirstName(i.fullName);
  const slot = i.slotBooking || '—';
  const when = i.slotInstantLabel || '—';
  const prefLang = i.preferredLanguage || '—';
  const bda = i.assignedBdaName || '—';
  const status = i.demoStatusLabel || '—';
  const meetingLink = opts.meetingLink || '—';

  const templates = {
    en: {
      greeting: firstName ? `Hi ${firstName}!` : 'Hi there!',
      title: 'Here is your IIT counselling summary:',
      session: 'Session',
      when: 'Date & Time (IST)',
      language: 'Language',
      counsellor: 'Your counsellor (BDA)',
      demo: 'Demo Status',
      link: 'Meeting Link',
      footer: 'Reply MENU for main menu or AGENT to speak with our team.',
      missing:
        'We could not find an IIT counselling registration for this number.\n\nReply MENU for more options.',
    },
    te: {
      greeting: firstName ? `హాయ్ ${firstName}!` : 'హాయ్!',
      title: 'మీ IIT counselling సారాంశం:',
      session: 'Session',
      when: 'తేదీ & సమయం (IST)',
      language: 'భాష',
      counsellor: 'మీ counsellor (BDA)',
      demo: 'Demo Status',
      link: 'Meeting Link',
      footer: 'MENU లేదా AGENT అని రిప్లై చేయండి.',
      missing: 'ఈ నంబర్‌కు IIT counselling registration కనుగొనలేకపోయాము.\n\nMENU అని రిప్లై చేయండి.',
    },
    hi: {
      greeting: firstName ? `नमस्ते ${firstName}!` : 'नमस्ते!',
      title: 'Yeh raha aapka IIT counselling summary:',
      session: 'Session',
      when: 'Date & Time (IST)',
      language: 'Bhasha',
      counsellor: 'Aapka counsellor (BDA)',
      demo: 'Demo Status',
      link: 'Meeting Link',
      footer: 'MENU ya AGENT likhein.',
      missing: 'Is number ke liye IIT counselling registration nahin mili.\n\nMENU likhein.',
    },
    ta: {
      greeting: firstName ? `வணக்கம் ${firstName}!` : 'வணக்கம்!',
      title: 'உங்கள் IIT counselling சுருக்கம்:',
      session: 'Session',
      when: 'தேதி & நேரம் (IST)',
      language: 'மொழி',
      counsellor: 'உங்கள் counsellor (BDA)',
      demo: 'Demo Status',
      link: 'Meeting Link',
      footer: 'MENU அல்லது AGENT என reply செய்யுங்கள்.',
      missing: 'இந்த எண்ணுக்கு IIT counselling registration கிடைக்கவில்லை.\n\nMENU என reply செய்யுங்கள்.',
    },
    kn: {
      greeting: firstName ? `ನಮಸ್ಕಾರ ${firstName}!` : 'ನಮಸ್ಕಾರ!',
      title: 'ನಿಮ್ಮ IIT counselling ಸಾರಾಂಶ:',
      session: 'Session',
      when: 'ದಿನಾಂಕ & ಸಮಯ (IST)',
      language: 'ಭಾಷೆ',
      counsellor: 'ನಿಮ್ಮ counsellor (BDA)',
      demo: 'Demo Status',
      link: 'Meeting Link',
      footer: 'MENU ಅಥವಾ AGENT ಎಂದು reply ಮಾಡಿ.',
      missing: 'ಈ ಸಂಖ್ಯೆಗೆ IIT counselling registration ಸಿಗಲಿಲ್ಲ.\n\nMENU ಎಂದು reply ಮಾಡಿ.',
    },
    ml: {
      greeting: firstName ? `നമസ്കാരം ${firstName}!` : 'നമസ്കാരം!',
      title: 'നിങ്ങളുടെ IIT counselling summary:',
      session: 'Session',
      when: 'തീയതി & സമയം (IST)',
      language: 'ഭാഷ',
      counsellor: 'നിങ്ങളുടെ counsellor (BDA)',
      demo: 'Demo Status',
      link: 'Meeting Link',
      footer: 'MENU അല്ലെങ്കിൽ AGENT എന്ന് reply ചെയ്യുക.',
      missing: 'ഈ നമ്പറിൽ IIT counselling registration കണ്ടെത്തിയില്ല.\n\nMENU എന്ന് reply ചെയ്യുക.',
    },
    mr: {
      greeting: firstName ? `नमस्कार ${firstName}!` : 'नमस्कार!',
      title: 'तुमचा IIT counselling सारांश:',
      session: 'Session',
      when: 'तारीख & वेळ (IST)',
      language: 'भाषा',
      counsellor: 'तुमचा counsellor (BDA)',
      demo: 'Demo Status',
      link: 'Meeting Link',
      footer: 'MENU किंवा AGENT म्हणून reply करा.',
      missing: 'या नंबरसाठी IIT counselling registration सापडली नाही.\n\nMENU म्हणून reply करा.',
    },
    bn: {
      greeting: firstName ? `নমস্কার ${firstName}!` : 'নমস্কার!',
      title: 'আপনার IIT counselling summary:',
      session: 'Session',
      when: 'তারিখ ও সময় (IST)',
      language: 'ভাষা',
      counsellor: 'আপনার counsellor (BDA)',
      demo: 'Demo Status',
      link: 'Meeting Link',
      footer: 'MENU বা AGENT লিখে reply করুন.',
      missing: 'এই নম্বরে IIT counselling registration পাওয়া যায়নি.\n\nMENU লিখে reply করুন.',
    },
  };

  const t = templates[lang] || templates.en;
  if (!leadContext?.hasIit || !leadContext?.iit) {
    return t.missing;
  }

  return [
    `${t.greeting} ${t.title}`,
    `• ${t.session}: ${slot}`,
    `• ${t.when}: ${when}`,
    `• ${t.language}: ${prefLang}`,
    `• ${t.counsellor}: ${bda}`,
    `• ${t.demo}: ${status}`,
    '',
    `${t.link}:`,
    meetingLink,
    '',
    t.footer,
  ].join('\n');
}

module.exports = {
  buildLocalizedCounsellingSupportReply,
};
