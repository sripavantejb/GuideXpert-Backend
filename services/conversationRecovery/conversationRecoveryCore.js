'use strict';

/**
 * Pure eligibility + phase mapping for Conversation Recovery.
 */

function deriveFlagsFromJourneyContext(ctx = {}) {
  const profile = ctx.profile || {};
  const journeyCompleted = profile.journeyCompleted === true;
  const bookingCompleted =
    profile.journeyOutcome === 'booking_initiated' ||
    profile.phase13UrlShared === true ||
    profile.bookingStatusFinal === 'url_shared';
  const optedOut = profile.journeyOutcome === 'opted_out';
  return { journeyCompleted, bookingCompleted, optedOut };
}

function mapStageToPhase(stage) {
  const s = String(stage || '');
  if (s.includes('phase_14') || s === 'journey_completed') return 14;
  if (s.includes('phase_13') || s.includes('booking')) return 13;
  if (s.includes('phase_12') || s.includes('counseling_recommendation')) return 12;
  if (s.includes('phase_11') || s.includes('hesitation') || s.includes('niat')) return 11;
  if (s.includes('phase_10') || s.includes('future_path')) return 10;
  if (s.includes('phase_9') || s.includes('personalized_recommendation')) return 9;
  if (s.includes('concern')) return 8;
  if (s.includes('comparison')) return 7;
  if (s.includes('shortlist')) return 6;
  // Explore modern colleges (roadmap P5) — check before generic "modern" / "personal"
  if (s.includes('explore_modern')) return 5;
  if (s.includes('personalized_discovery') || (s.includes('personal') && !s.includes('recommendation'))) {
    return 6;
  }
  if (s === 'modern_colleges' || (s.includes('modern') && !s.includes('explore'))) return 4;
  if (s.includes('evaluation')) return 3;
  if (s.includes('discovery') || !s) return 1;
  return 1;
}

function evaluateEligibility(snapshot = {}, caseDoc = null, config = {}, now = new Date()) {
  const reasons = [];
  if (!config.featureEnabled) {
    return { eligible: false, reasons: ['feature_disabled'] };
  }
  if (snapshot.journeyCompleted === true) reasons.push('journey_completed');
  if (snapshot.bookingCompleted === true) reasons.push('booking_completed');
  if (snapshot.optedOut === true) reasons.push('opted_out');
  if (caseDoc?.stopped === true || caseDoc?.status === 'stopped') reasons.push('stopped');
  if (caseDoc?.paused === true || caseDoc?.status === 'paused') reasons.push('paused');
  if (caseDoc?.status === 'opted_out') reasons.push('case_opted_out');
  if (caseDoc?.status === 'recovered') reasons.push('already_recovered');

  const attempts = Number(caseDoc?.attemptCount || 0);
  const maxAttempts = Number(config.maxAttempts || 3);
  if (attempts >= maxAttempts) reasons.push('max_attempts');

  const lastActivity = snapshot.lastActivityAt
    ? new Date(snapshot.lastActivityAt)
    : null;
  if (!lastActivity || Number.isNaN(lastActivity.getTime())) {
    reasons.push('missing_activity');
  } else {
    const inactiveMs = now.getTime() - lastActivity.getTime();
    const nextIntervalHours =
      config.intervalsHours?.[attempts] ??
      config.intervalsHours?.[config.intervalsHours.length - 1] ??
      config.inactivityBaseHours ??
      24;
    const thresholdMs = Number(nextIntervalHours) * 60 * 60 * 1000;
    if (inactiveMs < thresholdMs) reasons.push('not_inactive');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    attemptCount: attempts,
    maxAttempts,
  };
}

function nextScheduleAt(lastActivityAt, attemptNumber, config = {}, now = new Date()) {
  const intervals = config.intervalsHours || [24, 72, 168];
  const idx = Math.min(Math.max(attemptNumber - 1, 0), intervals.length - 1);
  const hours = intervals[idx] || 24;
  const base = lastActivityAt ? new Date(lastActivityAt) : now;
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function isRecoveryOptOutText(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase();
  if (!t) return false;
  return /^(stop|unsubscribe|opt out|optout|not interested|don't message|do not message|cancel recovery)$/i.test(
    t
  ) || /\b(stop messages|unsubscribe)\b/i.test(t);
}

module.exports = {
  deriveFlagsFromJourneyContext,
  mapStageToPhase,
  evaluateEligibility,
  nextScheduleAt,
  isRecoveryOptOutText,
};
