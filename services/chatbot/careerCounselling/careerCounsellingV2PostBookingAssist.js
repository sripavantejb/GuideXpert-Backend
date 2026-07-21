'use strict';

/**
 * Post-booking assist — answers content questions after form Done
 * without trapping the student in booking sticky copy.
 * Preserves profile / shortlist / Phase 9–13 memory.
 */

const {
  STAGES,
} = require('../../../constants/careerCounsellingV2BookingOrchestrator');
const {
  classifyConcernText,
  generatePersonalizedConcernResponse,
} = require('./careerCounsellingV2ConcernResolutionCore');
const {
  isPhase13BookNow,
  isPhase13Defer,
  isPhase13FormDone,
  isPhase13WrapUp,
  isExplicitBookingLinkRequest,
} = require('./careerCounsellingV2BookingOrchestratorParser');

function isPostBookingUnlocked(ctx = {}) {
  const step = String(ctx.step || '');
  const profile = ctx.profile || {};
  return (
    step === 'booking_completed' ||
    profile.phase13BookingCompleted === true ||
    profile.bookingCompleted === true
  );
}

/** Booking-control phrases stay in Phase 13 orchestrator. */
function isPostBookingControlPhrase(text) {
  if (isPhase13BookNow(text)) return true;
  if (isPhase13Defer(text)) return true;
  if (isPhase13FormDone(text)) return true;
  if (isPhase13WrapUp(text)) return true;
  if (isExplicitBookingLinkRequest(text)) return true;
  return false;
}

function detectPostBookingCategory(text) {
  const raw = String(text || '').trim();
  if (/\bscholarship(s)?\b|\bfunding\b|\bfinance\b/i.test(raw)) return 'fees';
  if (/\b(admission|admissions|apply|eligibility)\b/i.test(raw)) return 'rank_pressure';
  if (/\b(compar|vs\.?|versus|difference between|which (is|college)|better (fit|option))\b/i.test(raw)) {
    return 'confusion';
  }
  const classified = classifyConcernText(raw);
  return classified?.category || 'other';
}

/**
 * Answer a post-Done content question using concern personalized responses.
 * Never returns booking completion / question_fallback loops.
 */
function processPostBookingAssistTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const ctx = { ...context };
  const profile = { ...(ctx.profile || {}) };
  const analyticsMeta = opts.analytics || {};

  const category = detectPostBookingCategory(inbound);
  const reply = generatePersonalizedConcernResponse(profile, category, inbound);

  return {
    reply,
    context: {
      ...ctx,
      stage: STAGES.PHASE_13_BOOKING_ORCHESTRATOR,
      step: 'booking_completed',
      lastQuestionKey: 'post_booking_assist',
      profile: {
        ...profile,
        phase13BookingCompleted: true,
        bookingCompleted: true,
        phase13FormDoneAck: true,
      },
    },
    clearState: false,
    allowSkipAdvance: true,
    analytics: [
      {
        type: 'post_booking_assist',
        category,
        ...analyticsMeta,
      },
    ],
  };
}

module.exports = {
  isPostBookingUnlocked,
  isPostBookingControlPhrase,
  detectPostBookingCategory,
  processPostBookingAssistTurn,
};
