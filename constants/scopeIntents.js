'use strict';

const SCOPE_INTENTS = Object.freeze([
  'GUIDEXPERT',
  'IIT_COUNSELLING',
  'COLLEGE_PREDICTOR',
  'ADMISSIONS',
  'SCHOLARSHIPS',
  'BOOKING',
  'COUNSELLING_SESSION',
  'DOCUMENTS',
  'ELIGIBILITY',
  'SUPPORT',
  'SMALL_TALK',
  'PROGRAMMING',
  'GENERAL_KNOWLEDGE',
  'SPORTS',
  'POLITICS',
  'MOVIES',
  'FINANCE',
  'MEDICAL',
  'SHOPPING',
  'OTHER',
]);

const ALLOWED_INTENTS = new Set([
  'GUIDEXPERT',
  'IIT_COUNSELLING',
  'COLLEGE_PREDICTOR',
  'ADMISSIONS',
  'SCHOLARSHIPS',
  'BOOKING',
  'COUNSELLING_SESSION',
  'DOCUMENTS',
  'ELIGIBILITY',
  'SUPPORT',
  'SMALL_TALK',
]);

const CATEGORY_TO_INTENT = Object.freeze({
  iit_counselling: 'IIT_COUNSELLING',
  josaa: 'IIT_COUNSELLING',
  csab: 'IIT_COUNSELLING',
  rank_prediction: 'COLLEGE_PREDICTOR',
  college_prediction: 'COLLEGE_PREDICTOR',
  branch_guidance: 'ELIGIBILITY',
  career_guidance: 'ELIGIBILITY',
  admissions: 'ADMISSIONS',
  scholarship: 'SCHOLARSHIPS',
  scholarships: 'SCHOLARSHIPS',
  fees: 'ADMISSIONS',
  hostel: 'ADMISSIONS',
  placements: 'GUIDEXPERT',
  guidexpert_services: 'GUIDEXPERT',
  programming: 'PROGRAMMING',
  image_generation: 'GENERAL_KNOWLEDGE',
  movies: 'MOVIES',
  weather: 'GENERAL_KNOWLEDGE',
  sports: 'SPORTS',
  politics: 'POLITICS',
  finance: 'FINANCE',
  general_trivia: 'GENERAL_KNOWLEDGE',
  prompt_injection: 'OTHER',
  medical: 'MEDICAL',
  legal: 'OTHER',
  adult: 'OTHER',
  religion: 'OTHER',
  current_affairs: 'POLITICS',
  math: 'GENERAL_KNOWLEDGE',
  small_talk: 'SMALL_TALK',
  booking: 'BOOKING',
  counselling_session: 'COUNSELLING_SESSION',
  documents: 'DOCUMENTS',
  support: 'SUPPORT',
});

const CLASSIFIER_CATEGORY_TO_INTENT = Object.freeze({
  ...CATEGORY_TO_INTENT,
  branch_guidance: 'IIT_COUNSELLING',
  career_guidance: 'IIT_COUNSELLING',
  placements: 'ELIGIBILITY',
  scholarships: 'SCHOLARSHIPS',
});

function mapCategoryToIntent(category, { fromClassifier = false } = {}) {
  const key = String(category || '').trim().toLowerCase();
  const table = fromClassifier ? CLASSIFIER_CATEGORY_TO_INTENT : CATEGORY_TO_INTENT;
  return table[key] || 'OTHER';
}

function isIntentAllowed(intent) {
  return ALLOWED_INTENTS.has(intent);
}

function enrichScopeWithIntent(scope = {}) {
  const fromClassifier = Boolean(scope.classifierUsed);
  const category = scope.category || null;

  let intent = scope.intent;
  if (!intent) {
    if (category) {
      intent = mapCategoryToIntent(category, { fromClassifier });
    } else if (scope.allowed || scope.partialAllowed) {
      intent = 'GUIDEXPERT';
    } else {
      intent = 'OTHER';
    }
  }

  const confidence =
    scope.confidence ??
    scope.classifierResult?.confidence ??
    (scope.allowed || scope.partialAllowed ? 1 : 0.95);

  let allowed = Boolean(scope.allowed || scope.partialAllowed);
  if (scope.partialAllowed) {
    allowed = true;
  } else if (scope.policyBlock || scope.classifierBlock) {
    allowed = false;
  } else if (!scope.allowed) {
    allowed = false;
  } else if (category && !isIntentAllowed(intent)) {
    allowed = false;
  } else if (fromClassifier && scope.classifierResult && !scope.classifierResult.allowed) {
    allowed = false;
  } else if (fromClassifier && !isIntentAllowed(intent)) {
    allowed = false;
  }

  return {
    ...scope,
    intent,
    confidence,
    allowed,
    blocked: !allowed && !scope.partialAllowed,
  };
}

module.exports = {
  SCOPE_INTENTS,
  ALLOWED_INTENTS,
  CATEGORY_TO_INTENT,
  CLASSIFIER_CATEGORY_TO_INTENT,
  mapCategoryToIntent,
  isIntentAllowed,
  enrichScopeWithIntent,
};
