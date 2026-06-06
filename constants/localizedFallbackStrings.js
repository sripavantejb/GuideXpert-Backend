'use strict';

const {
  UNKNOWN_FALLBACK,
  OPPORTUNITY_FALLBACK,
  UNSUPPORTED_CLAIM_FALLBACK,
} = require('../services/chatbot/aiGuardrailService');

const KNOWLEDGE_ASSISTANT_FALLBACK_REPLY =
  'I am not sure I understood. Reply MENU for options or AGENT to speak with our team.';

const LOCALIZED_GUARDRAIL_FALLBACKS = {
  te: {
    [UNKNOWN_FALLBACK]:
      'నాకు దాని గురించి ధృవీకరించిన సమాచారం లేదు. సరైన వివరాల కోసం NIAT counselling team ను సంప్రదించండి.',
    [OPPORTUNITY_FALLBACK]:
      'అవకాశాలు నైపుణ్యాలు, పనితీరు మరియు వ్యక్తిగత పరిస్థితులపై ఆధారపడి ఉంటాయి.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'ఆ daava nu samarthinchaniki naaku dhruveekarinchina samachaaram ledu.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'నాకు అర్థం కాలేదు. ఎంపికల కోసం MENU లేదా మా టీమ్‌తో మాట్లాడడానికి AGENT అని రిప్లై చేయండి.',
  },
  hi: {
    [UNKNOWN_FALLBACK]:
      'Mere paas iske baare mein satyapit jaankari nahin hai. Sateek vivaran ke liye kripya NIAT counselling team se sampark karein.',
    [OPPORTUNITY_FALLBACK]:
      'Avsar kaushal, pradarshan aur vyaktigat paristhitiyon par nirbhar karte hain.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Us daave ka samarthan karne ke liye mere paas satyapit jaankari nahin hai.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Mujhe samajh nahin aaya. Vikalpon ke liye MENU ya hamari team se baat karne ke liye AGENT likhein.',
  },
  ta: {
    [UNKNOWN_FALLBACK]:
      'Adhaip pattri satyapikkappatta thagaval ennidam illai. NIAT counselling team-ai thodarbu kollungal.',
    [OPPORTUNITY_FALLBACK]:
      'Vaaipugal thiran, seyalthiram matrum thanipatta nilaiygalai adharikkum.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Anda kooralai atharikka ennidam satyapikkappatta thagaval illai.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Enakku puriyavillai. Viruppangalukku MENU allathu engal kuzhuvudan pesavum AGENT endru reply seiyungal.',
  },
  kn: {
    [UNKNOWN_FALLBACK]:
      'I visheyada satyapit mahiti nannalli illa. NIAT counselling team annu samparkisari.',
    [OPPORTUNITY_FALLBACK]:
      'Avakasha koushalya, pradarshana mattu vyaktigata paristhitigalannu avalambisutte.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'A daava samarthisalu nanage satyapit mahiti illa.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Nanage artha aagilla. MENU athava AGENT endu reply madi.',
  },
  ml: {
    [UNKNOWN_FALLBACK]:
      'Enikku ee vishayathinte satyapit vivaram illa. NIAT counselling team-ine samparkikkuka.',
    [OPPORTUNITY_FALLBACK]:
      'Avakasangal kousalyam, pradarshanam, vyaktigata sthithikal ennivayil aadharikkunnu.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Aa claim thsupport cheyyan enikku satyapit vivaram illa.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Enikku manasilaayilla. MENU allenkil AGENT ennu reply cheyyuka.',
  },
  mr: {
    [UNKNOWN_FALLBACK]:
      'Mala ya babtit satyapit mahiti nahi. NIAT counselling team shi sampark kara.',
    [OPPORTUNITY_FALLBACK]:
      'Sanadh kaushalya, pradarshan ani vyaktigat paristhiti yavar aadharit astat.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Tya daava cha samarthan karanyasathi mala satyapit mahiti nahi.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Mala samajle nahi. MENU kinva AGENT mhanun reply kara.',
  },
  bn: {
    [UNKNOWN_FALLBACK]:
      'Amar kache ei bishoye satyapit tathya nei. NIAT counselling team ke jogajog korun.',
    [OPPORTUNITY_FALLBACK]:
      'Sujog dakkho, prokash ebong byaktigato obosthar upor nirbhar kore.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Oi daawa samarthon korar jonno amar kache satyapit tathya nei.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Ami bujhte parchi na. MENU ba AGENT likhe reply korun.',
  },
};

function localizeKnownFallback(englishText, targetLanguage) {
  const lang = String(targetLanguage || 'en').toLowerCase();
  if (lang === 'en') return englishText;
  const map = LOCALIZED_GUARDRAIL_FALLBACKS[lang];
  if (!map) return englishText;
  return map[englishText] || englishText;
}

module.exports = {
  KNOWLEDGE_ASSISTANT_FALLBACK_REPLY,
  LOCALIZED_GUARDRAIL_FALLBACKS,
  localizeKnownFallback,
};
