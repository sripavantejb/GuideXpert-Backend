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
    'Aapne apni rank pehle hi de di hai, isliye Rank Predictor ki zaroorat nahin hai.',
    '',
    'Yeh prashn aam taur par College Predictor se handle hota hai.',
    '',
    'College Predictor abhi uplabdh nahin hai.',
    '',
    'Anya vikalpon ke liye MENU likhein.',
  ].join('\n'),
  ta: [
    'Neengal already ungal rank-ai kuduthu irukkeergal, athanaal Rank Predictor thevai illai.',
    '',
    'Indha kelvi usually College Predictor moolam handle aagum.',
    '',
    'College Predictor ippodhu kidaikkavillai.',
    '',
    'Mattru vaaippugalukku MENU endru reply seiyungal.',
  ].join('\n'),
  kn: [
    'Neeve nimma rank annu already kodiddiri, adarinda Rank Predictor beku illa.',
    '',
    'I prashne sādhāranavāgi College Predictor ninda nadesalaguttade.',
    '',
    'College Predictor prastuta labhyavilla.',
    '',
    'Itara vikalpagaligagi MENU endu reply madi.',
  ].join('\n'),
  ml: [
    'Ningal ninte rank nalki kazhinju, athinal Rank Predictor avashyamilla.',
    '',
    'I chodyam sādhāranamāyi College Predictor upayogikkunnu.',
    '',
    'College Predictor ippol labhyamalla.',
    '',
    'Mattu vikalpangalukku MENU ennu reply cheyyuka.',
  ].join('\n'),
  mr: [
    'Tumhi aadhich rank dileli aahe, mhanun Rank Predictorachi garaj nahi.',
    '',
    'Ha prashna sādhāranpanane College Predictor vapartat.',
    '',
    'College Predictor sada upalabdh nahi.',
    '',
    'Itar parayānsathi MENU mhanun reply kara.',
  ].join('\n'),
  bn: [
    'Apni already apnar rank diyechhen, tai Rank Predictor dorkar nei.',
    '',
    'Ei proshno sādhāranoto College Predictor diye handle hoy.',
    '',
    'College Predictor ekhon upalabdhho nei.',
    '',
    'Onno option-er jonno MENU likhe reply korun.',
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
