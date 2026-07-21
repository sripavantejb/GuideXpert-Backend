'use strict';

const {
  COUNSELING_SERVICES,
  GUARANTEE_FORBIDDEN,
  URL_FORBIDDEN,
  getPhase12Message,
} = require('../../../constants/careerCounsellingV2CounselingExperienceSelection');

function pickBestMatch(profile = {}) {
  const list = Array.isArray(profile.phase9Recommendations)
    ? profile.phase9Recommendations
    : [];
  const best = list.find((r) => r.rankLabel === 'Best Match') || list[0];
  if (best?.collegeName) return best.collegeName;
  const recommended = Array.isArray(profile.recommendedColleges)
    ? profile.recommendedColleges
    : [];
  const tierBest = recommended.find((c) => c.tier === 'best_match');
  return tierBest?.collegeName || null;
}

function assertPhase12Guardrails(text) {
  const t = String(text || '');
  for (const re of GUARANTEE_FORBIDDEN) {
    if (re.test(t)) throw new Error(`Phase 12 guardrail: ${re}`);
  }
  for (const re of URL_FORBIDDEN) {
    if (re.test(t)) throw new Error(`Phase 12 guardrail: URL forbidden (${re})`);
  }
  return t;
}

function shouldSkipPhase12(profile = {}) {
  if (profile.phase11Escalated === true) {
    return { skip: true, reason: 'phase11_escalated' };
  }
  if (profile.phase11ExitTarget === 'one_on_one_escalation') {
    return { skip: true, reason: 'phase11_ooo_exit' };
  }
  if (profile.niatOneOnOneRecommended === true) {
    return { skip: true, reason: 'niat_one_on_one_shown' };
  }
  return { skip: false, reason: null };
}

function hasParentSignals(profile = {}) {
  const blobs = [
    profile.parentPreferences,
    profile.parentConcerns,
    Array.isArray(profile.resolvedConcerns) ? profile.resolvedConcerns.join(' ') : '',
    Array.isArray(profile.phase11RaisedHesitations)
      ? profile.phase11RaisedHesitations.join(' ')
      : '',
    profile.phase11LastHesitationId,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    /\bparent|family|parental\b/i.test(String(blobs)) ||
    profile.phase11LastHesitationId === 'parent_alignment' ||
    (Array.isArray(profile.phase11RaisedHesitations) &&
      profile.phase11RaisedHesitations.includes('parent_alignment'))
  );
}

function hasAdmissionSignals(profile = {}) {
  const blobs = [
    Array.isArray(profile.resolvedConcerns) ? profile.resolvedConcerns.join(' ') : '',
    profile.phase11LastHesitationRaw,
    profile.concernNotes,
  ]
    .filter(Boolean)
    .join(' ');
  // Do not treat routine exam/rank capture alone as admission-service intent
  // (nearly every shortlisting journey has those).
  return /\badmission|eligibility|cutoff|how (do i|to) get (in|into)|apply(ing)?\b/i.test(
    String(blobs)
  );
}

function hasCareerSignals(profile = {}) {
  if (profile.phase11LastHesitationId === 'fit_confidence') return true;
  if (
    Array.isArray(profile.phase11RaisedHesitations) &&
    profile.phase11RaisedHesitations.includes('fit_confidence')
  ) {
    return true;
  }
  const priorities = Array.isArray(profile.studentPriorities)
    ? profile.studentPriorities
    : [];
  if (priorities.length >= 2) return true;
  if (profile.careerGoal && profile.futurePathVisionPresented) return true;
  return false;
}

function hasMultiFactorComplexity(profile = {}) {
  const hasBudget = Boolean(profile.budgetPreference || profile.budget);
  const hasLocation = Boolean(profile.locationPreference || profile.preferredCity);
  const hasParents = hasParentSignals(profile);
  return hasBudget && hasLocation && hasParents;
}

/**
 * Deterministic service selection — first match wins. No strength bands.
 */
function selectCounselingService(profile = {}) {
  const admission = hasAdmissionSignals(profile);
  const parents = hasParentSignals(profile);
  const multi = hasMultiFactorComplexity(profile);
  const career = hasCareerSignals(profile);
  const check = profile.phase11ConfidenceCheck;

  // 2. Admission signals dominate (unless parent+multi-factor complexity)
  if (admission && !(parents && multi)) {
    return {
      service: COUNSELING_SERVICES.ADMISSION,
      reasons: ['admission_guidance'],
    };
  }

  // 3. Parent alignment OR multi-factor complexity → one_on_one
  if (parents || multi) {
    const reasons = [];
    if (parents) reasons.push('parent_alignment');
    if (multi) reasons.push('budget_location_tradeoff');
    if (!reasons.length) reasons.push('confidence_context');
    return {
      service: COUNSELING_SERVICES.ONE_ON_ONE,
      reasons: reasons.slice(0, 2),
    };
  }

  // 4. Career / pathway clarity
  if (career) {
    const reasons = ['career_pathway'];
    const priorities = Array.isArray(profile.studentPriorities)
      ? profile.studentPriorities
      : [];
    if (priorities.length >= 2) reasons.push('multi_path_clarity');
    return {
      service: COUNSELING_SERVICES.CAREER,
      reasons: reasons.slice(0, 2),
    };
  }

  // 5. Confident completion → none
  if (check === 'ready' || check === 'yes') {
    return {
      service: COUNSELING_SERVICES.NONE,
      reasons: [],
    };
  }

  // 6. Default continue-path service
  return {
    service: COUNSELING_SERVICES.ONE_ON_ONE,
    reasons: ['confidence_context'],
  };
}

function buildPersonalizedServiceReply(profile = {}, selection = {}) {
  const service = selection.service || COUNSELING_SERVICES.NONE;
  const reasons = Array.isArray(selection.reasons) ? selection.reasons : [];
  const bestMatch = pickBestMatch(profile);
  const course = profile.preferredCourse
    ? String(profile.preferredCourse).slice(0, 60)
    : null;
  const goal = profile.careerGoal
    ? String(profile.careerGoal).slice(0, 60)
    : profile.careerPriority
      ? String(profile.careerPriority).slice(0, 60)
      : null;
  const budget = profile.budgetPreference
    ? String(profile.budgetPreference).slice(0, 40)
    : profile.financialPreference
      ? String(profile.financialPreference).slice(0, 40)
      : null;

  const pathBit = bestMatch
    ? `the path toward *${bestMatch}*`
    : course
      ? `your ${course} direction`
      : 'the direction you built in counseling';
  const goalBit = goal ? ` toward ${goal}` : '';
  const personalBits = [
    goal ? `goals around ${goal}` : null,
    course ? `interest in ${course}` : null,
    budget ? `budget context (${budget})` : null,
  ].filter(Boolean);
  const personalLine = personalBits.length
    ? `In the session, discussion can be tailored to your ${personalBits.join(', ')}, and career plans — including ${pathBit}.`
    : `In the session, discussion can be tailored to your goals, interests, and career plans — including ${pathBit}${goalBit}.`;

  const valueBullets = [
    '• Compare colleges in the context of *your* priorities',
    '• Build a clearer academic and career roadmap',
    '• Understand placements and internship pathways more realistically',
    '• Discuss scholarships and financing options',
    '• Gain career clarity so you can decide with more confidence',
  ];

  const credibility =
    "You'll have the opportunity to speak with one of our experienced career counselors, including IIT alumni where applicable.";
  const mission =
    'The goal is helping you choose the *right* college for you — not pushing one college.';

  let body;
  switch (service) {
    case COUNSELING_SERVICES.ADMISSION:
      body = [
        'A personalized *admission-focused* counseling session can help you move forward with more clarity.',
        '',
        personalLine,
        '',
        'Together you can:',
        ...valueBullets,
        '',
        mission,
        '',
        credibility,
      ].join('\n');
      break;
    case COUNSELING_SERVICES.CAREER:
      body = [
        'A personalized *career-pathway* counseling session can help you connect learning choices to practical next steps.',
        '',
        personalLine,
        '',
        'Together you can:',
        ...valueBullets,
        '',
        mission,
        '',
        credibility,
      ].join('\n');
      break;
    case COUNSELING_SERVICES.ONE_ON_ONE:
      body = [
        reasons.includes('parent_alignment')
          ? 'A personalized *One-on-One* counseling session can help you and your family discuss options with more clarity.'
          : 'A personalized *One-on-One* counseling session can help you decide with more clarity.',
        '',
        personalLine,
        '',
        'Together you can:',
        ...valueBullets,
        '',
        mission,
        '',
        credibility,
      ].join('\n');
      break;
    case COUNSELING_SERVICES.NONE:
    default:
      return {
        reply: getPhase12Message('soft_prompt_none'),
        service: COUNSELING_SERVICES.NONE,
        reasons: [],
        bestMatch,
      };
  }

  const reply = [body, '', getPhase12Message('soft_prompt_continue')].join('\n');
  assertPhase12Guardrails(reply);
  return { reply, service, reasons, bestMatch };
}

module.exports = {
  pickBestMatch,
  shouldSkipPhase12,
  selectCounselingService,
  buildPersonalizedServiceReply,
  assertPhase12Guardrails,
  hasParentSignals,
  hasAdmissionSignals,
  hasCareerSignals,
  hasMultiFactorComplexity,
  COUNSELING_SERVICES,
};
