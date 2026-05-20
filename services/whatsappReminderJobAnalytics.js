/**
 * P3: Scheduled-job coverage metrics for WhatsApp ops cohort views.
 */
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');

/**
 * @param {{ cohortSubmissionIds: import('mongoose').Types.ObjectId[], slotDayIst: string, messageKind: string, opsProduct?: string }} params
 */
async function computeReminderJobCoverageForCohort({
  cohortSubmissionIds,
  slotDayIst,
  messageKind,
  opsProduct = null,
  preferredLanguage = null
}) {
  const ids = Array.isArray(cohortSubmissionIds) ? cohortSubmissionIds : [];
  const booked = ids.length;
  const isIit = opsProduct === 'iit_counselling';

  if (!messageKind || !slotDayIst || !ids.length) {
    return {
      booked,
      scheduledJobs: 0,
      coverageGap: booked,
      byState: {},
      scheduledJobFunnel: {
        scheduled: 0,
        dispatched: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        exhausted: 0,
        skipped: 0,
        pending: 0,
        overdue: 0
      }
    };
  }

  const baseMatch = isIit
    ? { iitCounsellingSubmissionId: { $in: ids }, slotDayIst, messageKind }
    : { formSubmissionId: { $in: ids }, slotDayIst, messageKind };
  if (isIit && preferredLanguage) {
    baseMatch.preferredLanguage = preferredLanguage;
  }

  const now = new Date();
  const overdueSlaMs = parseInt(process.env.WA_REMINDER_JOB_OVERDUE_SLA_MS || '120000', 10) || 120000;
  const overdueBefore = new Date(now.getTime() - overdueSlaMs);

  const aggPromises = [
    WhatsAppReminderJob.countDocuments(baseMatch),
    WhatsAppReminderJob.aggregate([{ $match: baseMatch }, { $group: { _id: '$state', count: { $sum: 1 } } }]),
    WhatsAppReminderJob.countDocuments({
      ...baseMatch,
      state: { $in: ['pending', 'claimed', 'dispatching'] },
      scheduledSendAt: { $lte: overdueBefore },
    }),
  ];
  if (isIit) {
    aggPromises.push(
      WhatsAppReminderJob.aggregate([
        { $match: { ...baseMatch, state: 'skipped' } },
        { $group: { _id: '$suppressionReason', count: { $sum: 1 } } },
      ])
    );
  }
  const aggResults = await Promise.all(aggPromises);
  const scheduledJobs = aggResults[0];
  const stateRows = aggResults[1];
  const overdue = aggResults[2];
  const suppressionRows = isIit ? aggResults[3] : [];

  const byState = {};
  for (const row of stateRows) {
    byState[row._id] = row.count;
  }

  const dispatched =
    (byState.dispatched || 0) +
    (byState.delivered || 0) +
    (byState.read || 0) +
    (byState.failed || 0) +
    (byState.reconcile_pending || 0) +
    (byState.exhausted || 0);

  const suppressionByReason = {};
  for (const row of suppressionRows || []) {
    if (row._id) suppressionByReason[row._id] = row.count;
  }

  return {
    booked,
    scheduledJobs,
    coverageGap: Math.max(0, booked - scheduledJobs),
    byState,
    ...(isIit && Object.keys(suppressionByReason).length ? { suppressionByReason } : {}),
    scheduledJobFunnel: {
      scheduled: scheduledJobs,
      pending: byState.pending || 0,
      claimed: byState.claimed || 0,
      dispatching: byState.dispatching || 0,
      overdue,
      dispatched,
      delivered: (byState.delivered || 0) + (byState.read || 0),
      read: byState.read || 0,
      failed: byState.failed || 0,
      exhausted: byState.exhausted || 0,
      skipped: byState.skipped || 0,
      cancelled: byState.cancelled || 0,
      reconcilePending: byState.reconcile_pending || 0
    }
  };
}

module.exports = {
  computeReminderJobCoverageForCohort
};
