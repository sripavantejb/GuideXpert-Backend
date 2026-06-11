'use strict';

const {
  UNKNOWN_FALLBACK,
  OPPORTUNITY_FALLBACK,
  UNSUPPORTED_CLAIM_FALLBACK,
} = require('../services/chatbot/aiGuardrailService');
const {
  OSVI_BLOCKED_FALLBACK,
  COMPETITOR_BLOCKED_FALLBACK,
} = require('../services/chatbot/counsellorProgram/counsellorProgramGuardrailService');

const KNOWLEDGE_ASSISTANT_FALLBACK_REPLY =
  'I am not sure I understood. Reply MENU for options or AGENT to speak with our team.';

const LOCALIZED_GUARDRAIL_FALLBACKS = {
  te: {
    [UNKNOWN_FALLBACK]:
      'ఈ అంశంపై నాకు ప్రస్తుతం ధృవీకరించిన సమాచారం లేదు. సరైన మార్గదర్శకత్వం కోసం GuideXpert counselling team ను సంప్రదించండి.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'ఈ అంశంపై నాకు ప్రస్తుతం ధృవీకరించిన సమాచారం లేదు. సరైన మార్గదర్శకత్వం కోసం GuideXpert counselling team ను సంప్రదించండి.',
    [OPPORTUNITY_FALLBACK]:
      'అవకాశాలు నైపుణ్యాలు, పనితీరు మరియు వ్యక్తిగత పరిస్థితులపై ఆధారపడి ఉంటాయి.',
    [OSVI_BLOCKED_FALLBACK]:
      'ఇక్కడ అంతర్గత సిస్టమ్ వివరాలు పంచుకోలేను. GuideXpert counselling programs, fees మరియు చేరడం ఎలా అనేది చెప్పగలను—మీకు ఏమి తెలుసుకోవాలి?',
    [COMPETITOR_BLOCKED_FALLBACK]:
      'ఇతర ప్రొవైడర్లతో పోల్చకుండా GuideXpert counselling programs గురించి వివరిస్తాను. మీ అవసరం చెప్పండి, సరైన GuideXpert ఎంపిక సూచిస్తాను.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'నాకు అర్థం కాలేదు. ఎంపికల కోసం MENU లేదా మా టీమ్‌తో మాట్లాడడానికి AGENT అని రిప్లై చేయండి.',
  },
  hi: {
    [UNKNOWN_FALLBACK]:
      'Is vishay par mere paas abhi satyapit jaankari nahin hai. Sahi margdarshan ke liye GuideXpert counselling team se sampark karein.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Is vishay par mere paas abhi satyapit jaankari nahin hai. Sahi margdarshan ke liye GuideXpert counselling team se sampark karein.',
    [OPPORTUNITY_FALLBACK]:
      'Avsar kaushal, pradarshan aur vyaktigat paristhitiyon par nirbhar karte hain.',
    [OSVI_BLOCKED_FALLBACK]:
      'Yahan internal system details share nahin kar sakta. GuideXpert counselling programs, fees aur join karne ka tareeka bata sakta hoon—aap kya jaanna chahte hain?',
    [COMPETITOR_BLOCKED_FALLBACK]:
      'Main doosre providers se tulna ke bajay GuideXpert counselling programs samjhata hoon. Apni zaroorat batayein, main sahi GuideXpert option suggest karunga.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Mujhe samajh nahin aaya. Vikalpon ke liye MENU ya hamari team se baat karne ke liye AGENT likhein.',
  },
  ta: {
    [UNKNOWN_FALLBACK]:
      'Indha topic patri ennidam satyapikkappatta thagaval illa. GuideXpert counselling team-ai thodarbu kollungal.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Indha topic patri ennidam satyapikkappatta thagaval illa. GuideXpert counselling team-ai thodarbu kollungal.',
    [OPPORTUNITY_FALLBACK]:
      'Vaaipugal thiran, seyalthiram matrum thanipatta nilaiygalai adharikkum.',
    [OSVI_BLOCKED_FALLBACK]:
      'Internal system details inge share panna mudiyathu. GuideXpert counselling programs, fees, join seyyum murai solluven—ungalukku enna theriyanum?',
    [COMPETITOR_BLOCKED_FALLBACK]:
      'Vera providers-oda compare pannama GuideXpert counselling programs-ai vilakkuren. Ungal need-ai sollungal, sariyaana GuideXpert option suggest pannuven.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Enakku puriyavillai. Viruppangalukku MENU allathu engal kuzhuvudan pesavum AGENT endru reply seiyungal.',
  },
  kn: {
    [UNKNOWN_FALLBACK]:
      'E vishayadalli nanagige satyapit mahiti illa. GuideXpert counselling team annu samparkisari.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'E vishayadalli nanagige satyapit mahiti illa. GuideXpert counselling team annu samparkisari.',
    [OPPORTUNITY_FALLBACK]:
      'Avakasha koushalya, pradarshana mattu vyaktigata paristhitigalannu avalambisutte.',
    [OSVI_BLOCKED_FALLBACK]:
      'Internal system details illi share maadabodu. GuideXpert counselling programs, fees mattu join maaduvudu hege helabahudu—neevu enu tilukondu?',
    [COMPETITOR_BLOCKED_FALLBACK]:
      'Itara providers jote compare maadade GuideXpert counselling programs vivarane. Nimma avashyavannu heli, sariyaada GuideXpert option suggest maaduttene.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Nanage artha aagilla. MENU athava AGENT endu reply madi.',
  },
  ml: {
    [UNKNOWN_FALLBACK]:
      'Ee vishayathil enikku satyapit vivaram illa. GuideXpert counselling team-ine samparkikkuka.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Ee vishayathil enikku satyapit vivaram illa. GuideXpert counselling team-ine samparkikkuka.',
    [OPPORTUNITY_FALLBACK]:
      'Avakasangal kousalyam, pradarshanam, vyaktigata sthithikal ennivayil aadharikkunnu.',
    [OSVI_BLOCKED_FALLBACK]:
      'Internal system details ivide share cheyyan pattilla. GuideXpert counselling programs, fees, join cheyyunnathu engane enn parayam—ningalk entanu ariyanam?',
    [COMPETITOR_BLOCKED_FALLBACK]:
      'Mattu providers-um compare cheyyathe GuideXpert counselling programs vivarikkum. Ningalude avashyam parayoo, sariyaaya GuideXpert option suggest cheyyam.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Enikku manasilaayilla. MENU allenkil AGENT ennu reply cheyyuka.',
  },
  mr: {
    [UNKNOWN_FALLBACK]:
      'Ya vishayavaril mala satyapit mahiti nahi. GuideXpert counselling team shi sampark kara.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Ya vishayavaril mala satyapit mahiti nahi. GuideXpert counselling team shi sampark kara.',
    [OPPORTUNITY_FALLBACK]:
      'Sanadh kaushalya, pradarshan ani vyaktigat paristhiti yavar aadharit astat.',
    [OSVI_BLOCKED_FALLBACK]:
      'Internal system details ithe share karu shakat nahi. GuideXpert counselling programs, fees ani join kase karaycha te sangto—tumhala kay mahit pahije?',
    [COMPETITOR_BLOCKED_FALLBACK]:
      'Dusrya providers shi tulna na karta GuideXpert counselling programs samjavto. Tumchi garaj sanga, yogya GuideXpert parayay suggest karin.',
    [KNOWLEDGE_ASSISTANT_FALLBACK_REPLY]:
      'Mala samajle nahi. MENU kinva AGENT mhanun reply kara.',
  },
  bn: {
    [UNKNOWN_FALLBACK]:
      'Ei bishoye amar kache ekhon satyapit tathya nei. GuideXpert counselling team ke jogajog korun.',
    [UNSUPPORTED_CLAIM_FALLBACK]:
      'Ei bishoye amar kache ekhon satyapit tathya nei. GuideXpert counselling team ke jogajog korun.',
    [OPPORTUNITY_FALLBACK]:
      'Sujog dakkho, prokash ebong byaktigato obosthar upor nirbhar kore.',
    [OSVI_BLOCKED_FALLBACK]:
      'Ekhane internal system details share korte pari na. GuideXpert counselling programs, fees ebong join korar upay bolte pari—apni ki janben?',
    [COMPETITOR_BLOCKED_FALLBACK]:
      'Onno providers er sathe tulona na kore GuideXpert counselling programs bujhiye debo. Apnar proyojon bolun, thik GuideXpert option suggest korbo.',
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
