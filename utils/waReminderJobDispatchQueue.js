/**
 * P3 hardening: fair dispatch split between overdue and fresh-due jobs.
 */
const { overdueSlaMs } = require('./waReminderJobObservability');

function fairOverdueRatio() {
  const r = parseFloat(process.env.WA_REMINDER_JOB_FAIR_OVERDUE_RATIO || '0.8');
  if (!Number.isFinite(r)) return 0.8;
  return Math.min(1, Math.max(0, r));
}

function catchUpModeThreshold() {
  const t = parseFloat(process.env.WA_REMINDER_JOB_CATCHUP_MODE_RATIO || '0.5');
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
}

/**
 * @param {number} totalLimit
 * @param {number} [ratio]
 */
function computeFairClaimLimits(totalLimit, ratio = fairOverdueRatio()) {
  const limit = Math.max(1, totalLimit || 1);
  const overdueLimit = Math.floor(limit * ratio);
  const freshLimit = Math.max(0, limit - overdueLimit);
  return { overdueLimit, freshLimit, ratio };
}

/**
 * @param {Date} now
 * @param {Date} scheduledSendAt
 */
function isOverdueForFairness(now, scheduledSendAt) {
  const sla = overdueSlaMs();
  const overdueBefore = new Date(now.getTime() - sla);
  return new Date(scheduledSendAt).getTime() <= overdueBefore.getTime();
}

/**
 * @param {{ overdueCount: number, freshDueCount: number }} counts
 */
function isCatchUpModeActive(counts) {
  const total = (counts.overdueCount || 0) + (counts.freshDueCount || 0);
  if (total === 0) return false;
  return (counts.overdueCount || 0) / total >= catchUpModeThreshold();
}

module.exports = {
  fairOverdueRatio,
  catchUpModeThreshold,
  computeFairClaimLimits,
  isOverdueForFairness,
  isCatchUpModeActive
};
