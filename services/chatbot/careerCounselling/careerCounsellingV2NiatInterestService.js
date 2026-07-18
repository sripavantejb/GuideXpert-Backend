'use strict';

const {
  ONE_ON_ONE_SESSION_URL,
  NIAT_INTEREST_STAGE,
  NIAT_INTEREST_STEP,
  NIAT_INTEREST_PATTERNS,
  NIAT_NON_INTEREST_PATTERNS,
  GUARANTEE_FORBIDDEN,
  buildNiatOneOnOneReply,
} = require('../../../constants/careerCounsellingV2NiatInterest');
const {
  logNiatInterestDetected,
  logNiatOneOnOneRecommended,
} = require('./careerCounsellingV2Analytics');

function mentionsNiat(text) {
  return /\bniat\b/i.test(String(text || ''));
}

function isNonInterestNiatMention(text) {
  const raw = String(text || '').trim();
  if (!raw || !mentionsNiat(raw)) return false;
  return NIAT_NON_INTEREST_PATTERNS.some((re) => re.test(raw));
}

/**
 * Deterministic high-confidence NIAT interest / admission intent.
 * Does not fire on mere comparison or informational mentions.
 */
function detectNiatInterest(text) {
  const raw = String(text || '').trim();
  if (!raw || !mentionsNiat(raw)) {
    return { matched: false, reason: 'no_niat' };
  }
  if (isNonInterestNiatMention(raw)) {
    return { matched: false, reason: 'informational_or_comparison' };
  }
  for (const re of NIAT_INTEREST_PATTERNS) {
    if (re.test(raw)) {
      return { matched: true, reason: 'explicit_interest', pattern: String(re) };
    }
  }
  return { matched: false, reason: 'niat_without_intent' };
}

function assertNiatTransitionGuardrails(text) {
  const t = String(text || '');
  for (const re of GUARANTEE_FORBIDDEN) {
    if (re.test(t)) throw new Error(`NIAT transition guardrail: ${re}`);
  }
  const urls = t.match(/https?:\/\/[^\s]+/gi) || [];
  for (const url of urls) {
    if (url.replace(/[).,]+$/, '') !== ONE_ON_ONE_SESSION_URL) {
      throw new Error(`NIAT transition guardrail: non-official URL ${url}`);
    }
  }
  if (!t.includes(ONE_ON_ONE_SESSION_URL)) {
    throw new Error('NIAT transition guardrail: missing official URL');
  }
  return t;
}

function buildNiatInterestOneOnOneResult(ctx = {}, detection = {}, analyticsMeta = {}) {
  const reply = buildNiatOneOnOneReply();
  assertNiatTransitionGuardrails(reply);

  logNiatInterestDetected({
    stage: NIAT_INTEREST_STAGE,
    reason: detection.reason || 'explicit_interest',
    priorStage: ctx.stage || null,
    priorStep: ctx.step || null,
    ...analyticsMeta,
  });
  logNiatOneOnOneRecommended({
    stage: NIAT_INTEREST_STAGE,
    url: ONE_ON_ONE_SESSION_URL,
    funnel: 'niat_interest',
    ...analyticsMeta,
  });

  return {
    reply,
    context: {
      ...ctx,
      stage: NIAT_INTEREST_STAGE,
      step: NIAT_INTEREST_STEP,
      lastQuestionKey: 'niat_one_on_one',
      profile: {
        ...(ctx.profile || {}),
        niatInterestDetected: true,
        niatOneOnOneRecommended: true,
        niatOneOnOneUrl: ONE_ON_ONE_SESSION_URL,
        niatInterestReason: detection.reason || 'explicit_interest',
        // Distinct from Phase 11 objection escalation
        niatInterestFunnel: 'niat_interest',
      },
      niatInterestAt: new Date().toISOString(),
    },
    clearState: false,
    analytics: [
      { type: 'niat_interest_detected', reason: detection.reason },
      { type: 'one_on_one_recommended', source: 'niat_interest' },
      { type: 'niat_one_on_one_recommended', funnel: 'niat_interest' },
    ],
  };
}

/**
 * If inbound shows explicit NIAT interest, return One-on-One transition; else null.
 */
function tryNiatInterestTransition(text, context = {}, opts = {}) {
  const detection = detectNiatInterest(text);
  if (!detection.matched) return null;
  return buildNiatInterestOneOnOneResult(context, detection, opts.analytics || {});
}

/** Sticky follow-up while on NIAT One-on-One offer step. */
function processNiatInterestFollowUp(text, context = {}) {
  const inbound = String(text || '').trim();
  const t = inbound.toLowerCase();
  if (/^(done|thanks|thank you|ok|okay|got it|finish|finished)$/i.test(t)) {
    return {
      reply: 'Glad that helped. You can return anytime if you want NIAT admission guidance.',
      context: {
        ...context,
        stage: 'conversation_complete',
        step: 'conversation_complete',
        profile: {
          ...(context.profile || {}),
          niatOneOnOneAcknowledged: true,
        },
      },
      clearState: false,
      analytics: [],
    };
  }

  const again = detectNiatInterest(inbound);
  if (again.matched) {
    return buildNiatInterestOneOnOneResult(context, again, {});
  }

  return {
    reply: [
      'Whenever you’re ready, the optional One-on-One NIAT counseling form is here:',
      ONE_ON_ONE_SESSION_URL,
    ].join('\n'),
    context,
    clearState: false,
    analytics: [],
  };
}

module.exports = {
  detectNiatInterest,
  tryNiatInterestTransition,
  processNiatInterestFollowUp,
  buildNiatInterestOneOnOneResult,
  assertNiatTransitionGuardrails,
  ONE_ON_ONE_SESSION_URL,
  NIAT_INTEREST_STAGE,
  NIAT_INTEREST_STEP,
};
