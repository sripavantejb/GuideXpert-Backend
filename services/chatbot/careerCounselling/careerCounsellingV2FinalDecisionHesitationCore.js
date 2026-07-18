'use strict';

const {
  HESITATION_CATEGORIES,
  getHesitationById,
  getPhase11Message,
  GUARANTEE_FORBIDDEN,
  ONE_ON_ONE_SESSION_URL,
  ESCALATION_THRESHOLDS,
  MULTI_TOPIC_SIGNALS,
} = require('../../../constants/careerCounsellingV2FinalDecisionHesitation');

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

function assertNoGuarantees(text) {
  const t = String(text || '');
  for (const re of GUARANTEE_FORBIDDEN) {
    if (re.test(t)) throw new Error(`Phase 11 guardrail: ${re}`);
  }
  if (/\bcounsellor\b|\bcounselor\b|\bbook(ing)?\b|\bwhatsapp\b/i.test(t)) {
    throw new Error('Phase 11 guardrail: CTA language');
  }
  return t;
}

function assertEscalationGuardrails(text) {
  const t = String(text || '');
  for (const re of GUARANTEE_FORBIDDEN) {
    if (re.test(t)) throw new Error(`Phase 11 escalation guardrail: ${re}`);
  }
  if (/\bmust (book|decide)|limited seats|act now|hurry\b/i.test(t)) {
    throw new Error('Phase 11 escalation guardrail: pressure');
  }
  const urls = t.match(/https?:\/\/[^\s]+/gi) || [];
  for (const url of urls) {
    if (url.replace(/[).,]+$/, '') !== ONE_ON_ONE_SESSION_URL) {
      throw new Error(`Phase 11 escalation guardrail: non-official URL ${url}`);
    }
  }
  if (!t.includes(ONE_ON_ONE_SESSION_URL)) {
    throw new Error('Phase 11 escalation guardrail: missing official URL');
  }
  return t;
}

function classifyHesitation(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  for (const cat of HESITATION_CATEGORIES) {
    if (cat.patterns.some((re) => re.test(raw))) {
      return { id: cat.id, label: cat.label, rawAnswer: raw.slice(0, 300) };
    }
  }
  if (/\bfee|afford|budget|distance|hostel|placement|branch|course\b/i.test(raw)) {
    const cat = getHesitationById('decision_uncertainty');
    return { id: cat.id, label: cat.label, rawAnswer: raw.slice(0, 300), supportingContext: true };
  }
  const fallback = getHesitationById('decision_uncertainty');
  return { id: fallback.id, label: fallback.label, rawAnswer: raw.slice(0, 300) };
}

function countMultiTopics(text) {
  const raw = String(text || '');
  return MULTI_TOPIC_SIGNALS.filter((s) => s.pattern.test(raw)).map((s) => s.id);
}

function isReassuranceAsk(text) {
  return /\b(are you sure|really (sure|right)|need (more )?reassurance|please confirm|keep (me )?reassur|still not (sure|confident)|need (someone|somebody) to (confirm|reassure))\b/i.test(
    String(text || '')
  );
}

function buildPersonalizedHesitationReply(profile = {}, hesitationId) {
  const bestMatch = pickBestMatch(profile);
  const course = profile.preferredCourse
    ? String(profile.preferredCourse).slice(0, 60)
    : null;
  const goal = profile.careerGoal
    ? String(profile.careerGoal).slice(0, 60)
    : profile.careerPriority
      ? String(profile.careerPriority).slice(0, 60)
      : null;
  const learning =
    profile.learningStyle ||
    profile.identifiedLearningStyle ||
    (Array.isArray(profile.learningPreferences) && profile.learningPreferences[0]) ||
    null;
  const interest =
    (Array.isArray(profile.studentPriorities) && profile.studentPriorities[0]) ||
    (Array.isArray(profile.evaluationPriorities) && profile.evaluationPriorities[0]) ||
    null;
  const prior =
    Array.isArray(profile.resolvedConcerns) && profile.resolvedConcerns.length
      ? profile.resolvedConcerns.slice(0, 2).join(', ')
      : null;

  const pathBit = bestMatch
    ? `the path toward *${bestMatch}*`
    : course
      ? `your ${course} direction`
      : 'the direction you’ve already built in counseling';

  const goalBit = goal ? ` toward ${goal}` : '';
  const learnBit = learning ? ` and how you like to learn (${String(learning).slice(0, 40)})` : '';
  const interestBit = interest ? ` Interests you flagged still matter (${String(interest).slice(0, 40)}).` : '';
  const priorBit = prior
    ? ` You already worked through earlier concerns (${prior}) — this step is only about deciding with that context.`
    : ' This step is only about deciding with the counseling context you already have.';

  let body;
  switch (hesitationId) {
    case 'parent_alignment':
      body = [
        `Feeling unsure about family agreement is common at decision time.`,
        `You can share ${pathBit}${goalBit} using what you already clarified — course fit${learnBit}.${interestBit}`,
        `The goal isn’t pressure — it’s helping everyone see the same evidence you built.${priorBit}`,
      ].join(' ');
      break;
    case 'wrong_choice_fear':
      body = [
        `Fear of choosing wrong is a final-decision feeling — not a sign you need to restart evaluation.`,
        `${pathBit} already reflects what you shared${goalBit}${learnBit}.${interestBit}`,
        `A good next check is fit to your goals, not a perfect prediction of the future.${priorBit}`,
      ].join(' ');
      break;
    case 'academic_manageability':
      body = [
        `Academic worry at decision time is understandable.`,
        `Your counseling path already considered ${course || 'your course interest'}${learnBit} — manageability is about steady preparation, not a promise of outcomes.`,
        `${pathBit} is a direction to grow into, not a promise of ease.${priorBit}`,
      ].join(' ');
      break;
    case 'fit_confidence':
      body = [
        `“Is this right?” is the classic last question before committing.`,
        `Fit confidence here means: ${pathBit} lines up with what you said you want${goalBit}${learnBit}.${interestBit}`,
        `It won’t remove all uncertainty — it should make the decision feel grounded, not rushed.${priorBit}`,
      ].join(' ');
      break;
    case 'decision_uncertainty':
    default:
      body = [
        `Still feeling unsure at the end is normal.`,
        `You’ve already narrowed ${pathBit}${goalBit}${learnBit}.${interestBit}`,
        `You don’t need a perfect answer — just enough clarity that the next step feels honest.${priorBit}`,
      ].join(' ');
      break;
  }

  const reply = [body, '', getPhase11Message('confirm')].join('\n');
  assertNoGuarantees(reply);
  return { reply, bestMatch, hesitationId };
}

/**
 * Escalation is exceptional — never the default after a single resolved hesitation.
 */
function evaluatePhase11Escalation(ctx = {}, opts = {}) {
  if (opts.explicitExpert) {
    return { escalate: true, reason: 'explicit_expert_request' };
  }

  const profile = ctx.profile || {};
  const raised = Array.isArray(profile.phase11RaisedHesitations)
    ? profile.phase11RaisedHesitations.filter((id) => id && id !== 'none')
    : [];
  const responses = Number(profile.phase11PersonalizedResponseCount || 0);
  const confidenceNo = Number(profile.phase11ConfidenceNoCount || 0);
  const reassurance = Number(profile.phase11ReassuranceAskCount || 0);
  const multiTopic = Boolean(profile.phase11MultiTopicUtterance);
  const check = profile.phase11ConfidenceCheck;

  const thresholds = ESCALATION_THRESHOLDS;

  if (
    check === 'ready' ||
    (check === 'yes' &&
      responses <= 1 &&
      raised.length <= 1 &&
      confidenceNo === 0 &&
      reassurance < thresholds.minReassuranceAsks &&
      !multiTopic)
  ) {
    return { escalate: false, reason: 'single_resolved_or_ready' };
  }

  if (check === 'no_after_second' || check === 'second_addressed') {
    if (
      responses >= thresholds.minPersonalizedResponsesBeforeEscalate ||
      confidenceNo >= thresholds.minConfidenceNo
    ) {
      return { escalate: true, reason: 'repeated_unresolved_hesitation' };
    }
  }

  if (raised.length >= thresholds.minDistinctHesitations) {
    return { escalate: true, reason: 'multiple_distinct_hesitations' };
  }

  if (multiTopic) {
    return { escalate: true, reason: 'multiple_concerns_simultaneous' };
  }

  if (reassurance >= thresholds.minReassuranceAsks) {
    return { escalate: true, reason: 'repeated_reassurance' };
  }

  if (
    confidenceNo >= thresholds.minConfidenceNo &&
    responses >= thresholds.minPersonalizedResponsesBeforeEscalate
  ) {
    return { escalate: true, reason: 'beyond_deterministic_capacity' };
  }

  return { escalate: false, reason: 'threshold_not_met' };
}

function buildOneOnOneEscalationReply(profile = {}, decision = {}) {
  const bestMatch = pickBestMatch(profile);
  const pathBit = bestMatch ? ` (including the path toward *${bestMatch}*)` : '';
  const reasonNote =
    decision.reason === 'explicit_expert_request'
      ? 'Since you asked to speak with an expert, here’s the optional One-on-One path.'
      : `We’ve already covered your counseling context${pathBit}; what’s left is situation-specific.`;

  const reply = [
    getPhase11Message('escalation_ack'),
    '',
    getPhase11Message('escalation_summary'),
    '',
    reasonNote,
    '',
    getPhase11Message('escalation_value'),
    '',
    getPhase11Message('escalation_cta'),
    ONE_ON_ONE_SESSION_URL,
    '',
    getPhase11Message('escalation_soft_close'),
  ].join('\n');

  assertEscalationGuardrails(reply);
  return { reply, url: ONE_ON_ONE_SESSION_URL, reason: decision.reason || null };
}

module.exports = {
  pickBestMatch,
  classifyHesitation,
  buildPersonalizedHesitationReply,
  assertNoGuarantees,
  assertEscalationGuardrails,
  countMultiTopics,
  isReassuranceAsk,
  evaluatePhase11Escalation,
  buildOneOnOneEscalationReply,
  ONE_ON_ONE_SESSION_URL,
  ESCALATION_THRESHOLDS,
};
