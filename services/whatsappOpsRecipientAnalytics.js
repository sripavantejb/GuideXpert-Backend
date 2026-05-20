/**
 * Deterministic recipient-based WhatsApp ops analytics (booking cohort: IST slot calendar day
 * + optional slot time, FormSubmission-backed). All-templates rollup groups by phone across message kinds.
 */
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { WHATSAPP_MESSAGE_KINDS: ALLOWED_MESSAGE_KINDS } = WhatsAppMessageEvent;
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const FormSubmission = require('../models/FormSubmission');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const {
  parseOpsProductQuery,
  effectiveOverviewMessageKind,
  matchWhatsAppEventsByOpsProduct
} = require('../utils/whatsappOpsProduct');
const {
  istDayRangeFromIso,
  annotateEventsWithSlotDayPipeline: annotateEventsWithSlotDayPipelineBase
} = require('./whatsappOpsCohortShared');
const { getReminderOffsetsMsForDiagnostics } = require('../utils/waReminderEligibility');
const { validateRecipientAnalyticsInvariants } = require('../utils/waAnalyticsIntegrity');
const canonical = require('./whatsappOpsCanonicalMetrics');
const { computeReminderJobCoverageForCohort } = require('./whatsappReminderJobAnalytics');

const IIT_LANGUAGE_BUCKETS = ['Telugu', 'Hindi', 'unknown'];
const ALLOWED_SLOT_TIME_SUFFIXES = ['11AM', '3PM', '6PM', '7PM'];
const ACCEPTED_STATUSES = canonical.ACCEPTED_STATUSES;
const SENT_PLUS = canonical.SENT_PLUS;
const DELIVERED_PLUS = canonical.DELIVERED_PLUS;
const TERMINAL_FAILURE = canonical.TERMINAL_FAILURE;
const IN_FLIGHT = canonical.IN_FLIGHT;
const RECONCILE_PENDING = canonical.RECONCILE_PENDING;

const divPct = canonical.divPct;
const buildRecipientOutcomeBreakdown = canonical.buildRecipientOutcomeBreakdown;

/** @param {unknown} raw */
function normalizeSlotTimeParam(raw) {
  if (raw == null || raw === '') return 'all';
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === 'all') return 'all';
  const u = s.toUpperCase();
  if (ALLOWED_SLOT_TIME_SUFFIXES.includes(u)) return u;
  return null;
}

function buildBookingCohortFilter(range, slotTimeNorm) {
  const q = {
    isRegistered: true,
    'step3Data.slotDate': { $gte: range.from, $lte: range.to }
  };
  if (slotTimeNorm && slotTimeNorm !== 'all') {
    q['step3Data.selectedSlot'] = new RegExp(`_${slotTimeNorm}$`);
  }
  return q;
}

/** Strict IST slot-day from submission only (no createdAt cohort fallback). */
function annotateEventsWithSlotDayPipeline(messageKindFilter, opsProductRaw = null) {
  return annotateEventsWithSlotDayPipelineBase(messageKindFilter, {
    strictSlotDay: true,
    opsProduct: opsProductRaw
  });
}

function buildIitBookingCohortFilter(range, slotTimeNorm) {
  const q = {
    counsellingSlotInstantUtc: { $gte: range.from, $lte: range.to }
  };
  if (slotTimeNorm && slotTimeNorm !== 'all') {
    if (slotTimeNorm === '6PM') {
      q['iitCounselling.section1Data.slotBooking'] = { $in: ['Wednesday 6PM', 'Saturday 6PM'] };
    } else if (slotTimeNorm === '11AM') {
      q['iitCounselling.section1Data.slotBooking'] = 'Sunday 11AM';
    } else {
      return { ...q, _id: { $in: [] } };
    }
  }
  return q;
}

/**
 * @returns {Promise<object>}
 */
async function computeRecipientDayOverview({
  dateIso,
  messageKind = null,
  slotTime = 'all',
  opsProduct = null
} = {}) {
  if (messageKind && !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
    return { error: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}` };
  }
  const slotTimeNorm = normalizeSlotTimeParam(slotTime);
  if (slotTimeNorm === null) {
    return { error: `Invalid slotTime. Allowed: all, ${ALLOWED_SLOT_TIME_SUFFIXES.join(', ')}` };
  }
  const range = istDayRangeFromIso(dateIso);
  if (!range) return { error: 'Invalid date format. Use YYYY-MM-DD' };

  const opsSlug = parseOpsProductQuery(opsProduct);
  const effKind = effectiveOverviewMessageKind(opsProduct, messageKind);
  const cohortFilter =
    opsSlug === 'iit_counselling'
      ? buildIitBookingCohortFilter(range, slotTimeNorm)
      : buildBookingCohortFilter(range, slotTimeNorm);
  const [cohortBookedCount, cohortIds] = await Promise.all([
    opsSlug === 'iit_counselling'
      ? IitCounsellingSubmission.countDocuments(cohortFilter)
      : FormSubmission.countDocuments(cohortFilter),
    opsSlug === 'iit_counselling'
      ? IitCounsellingSubmission.distinct('_id', cohortFilter)
      : FormSubmission.distinct('_id', cohortFilter)
  ]);

  const idField = opsSlug === 'iit_counselling' ? 'iitCounsellingSubmissionId' : 'formSubmissionId';
  const withWaIds =
    cohortIds.length > 0
      ? await WhatsAppMessageEvent.distinct(idField, {
          ...matchWhatsAppEventsByOpsProduct(opsSlug),
          [idField]: { $in: cohortIds },
          ...(effKind ? { messageKind: effKind } : {})
        })
      : [];
  const withWaSet = new Set(withWaIds.map((id) => String(id)));
  const bookedWithoutAnyWaEvent = cohortIds.filter((id) => !withWaSet.has(String(id))).length;

  const slotDayMatch = { $match: { slotDayIst: range.isoDate } };
  const cohortMatch =
    opsSlug === 'iit_counselling'
      ? { $match: { iitCounsellingSubmissionId: { $in: cohortIds } } }
      : { $match: { formSubmissionId: { $in: cohortIds } } };
  const annotate = annotateEventsWithSlotDayPipeline(effKind, opsProduct);

  const baseAfterAnnotate = [
    ...annotate,
    { $match: { slotDayIst: { $ne: null } } },
    slotDayMatch,
    cohortMatch
  ];

  const recipientRollupStages = [
    ...baseAfterAnnotate,
    ...canonical.buildRecipientRollupPipelineStages(!!messageKind)
  ];

  const [recipientRows, groupSchedule] = await Promise.all([
    WhatsAppMessageEvent.aggregate(recipientRollupStages),
    WhatsAppRetryGroup.find({
      status: 'open',
      nextPromotionDueAt: { $ne: null },
      ...(messageKind ? { messageKind } : {})
    })
      .select('messageKind nextPromotionDueAt attempt2BatchId attempt3BatchId')
      .sort({ nextPromotionDueAt: 1 })
      .limit(50)
      .lean()
  ]);

  const recipients = recipientRows || [];
  const rolled = canonical.rollupRecipientTotals(recipients);
  const { exclusionBreakdown, excludedTotal } = canonical.buildRecipientExclusionBreakdown(recipients);

  const funnelStages = await WhatsAppMessageEvent.aggregate([
    ...baseAfterAnnotate,
    ...canonical.buildFunnelPerAttemptGroupStages(!!messageKind),
    {
      $group: {
        _id: '$_id.attempt',
        targetedRecipients: { $sum: 1 },
        accepted: { $sum: '$accepted' },
        sent: { $sum: '$sent' },
        delivered: { $sum: '$delivered' },
        read: { $sum: '$read' },
        failed: { $sum: '$failed' },
        inFlight: { $sum: '$inFlight' },
        excluded: { $sum: '$excluded' }
      }
    }
  ]);

  const byAttempt = canonical.collapseFunnelStagesByAttempt(funnelStages);
  const retryFunnelReconciliation = canonical.buildRetryFunnelReconciliation(recipients);

  const nextDue = groupSchedule.length ? groupSchedule[0].nextPromotionDueAt : null;

  /** @type {object | null} */
  let cohortFlow = null;
  if (messageKind) {
    const recipientOutcomeBreakdown = buildRecipientOutcomeBreakdown(recipients);
    const jobCoverage = await computeReminderJobCoverageForCohort({
      cohortSubmissionIds: cohortIds,
      slotDayIst: range.isoDate,
      messageKind: effKind || messageKind,
      opsProduct: opsSlug,
    });
    cohortFlow = {
      booked: cohortBookedCount,
      scheduledJobs: jobCoverage.scheduledJobs,
      coverageGap: jobCoverage.coverageGap,
      scheduledJobFunnel: jobCoverage.scheduledJobFunnel,
      scheduledJobByState: jobCoverage.byState,
      withTemplateEventBookings: withWaIds.length,
      withoutTemplateEventBookings: bookedWithoutAnyWaEvent,
      effectiveMessageKind: effKind || messageKind,
      recipientOutcomeBreakdown,
      metricsNote:
        'Coverage uses durable WhatsAppReminderJob rows (P3). Delivery KPIs remain recipient-primary from WhatsAppMessageEvent.'
    };
    if (
      messageKind === 'pre4hr' &&
      opsSlug === 'guidexpert' &&
      cohortIds.length > 0
    ) {
      const reminderSentTrueBookings = await FormSubmission.countDocuments({
        _id: { $in: cohortIds },
        reminderSent: true
      });
      cohortFlow.pre4hrReminderSentCorrelate = {
        reminderSentTrueBookings,
        reminderSentNotTrueBookings: Math.max(0, cohortBookedCount - reminderSentTrueBookings)
      };
    }
    if (process.env.NODE_ENV !== 'production' && recipientOutcomeBreakdown.sumCheck !== recipientOutcomeBreakdown.total) {
      // eslint-disable-next-line no-console
      console.warn('[whatsappOpsRecipientAnalytics] recipientOutcomeBreakdown sum mismatch', recipientOutcomeBreakdown);
    }
  }

  const recipientTotals = {
    ...rolled,
    booked: cohortBookedCount,
    excluded: excludedTotal,
    excludedTotal,
    bookedWithoutAnyWaEvent,
    finalFailedNote:
      'finalFailed equals permanent terminal failures only; reconcile-pending and transient unresolved are separate KPIs.'
  };

  const integrity = validateRecipientAnalyticsInvariants({
    recipientTotals,
    outcomeBreakdown: rolled.outcomeBreakdown,
    retryFunnelByAttempt: byAttempt,
    retryFunnelReconciliation
  });
  if (process.env.NODE_ENV !== 'production' && !integrity.ok) {
    // eslint-disable-next-line no-console
    console.warn('[whatsappOpsRecipientAnalytics] integrity', integrity.violations);
  }

  return {
    data: {
      ...canonical.buildAnalyticsMeta({
        attemptMetricsNote:
          'Primary KPIs count unique recipients (lineage+phone+template). Attempt-level rows are diagnostic only.'
      }),
      filter: { date: range.isoDate, messageKind: messageKind || null, slotTime: slotTimeNorm, opsProduct: opsSlug },
      range: { from: range.from, to: range.to },
      bookedSlotsCount: cohortBookedCount,
      recipientTotals,
      ...(cohortFlow ? { cohortFlow } : {}),
      exclusionBreakdown,
      retryFunnelByAttempt: byAttempt,
      retryFunnelReconciliation,
      integrityWarnings: integrity.violations,
      retryQueue: {
        nextPromotionDueAt: nextDue,
        openGroupsSample: groupSchedule.slice(0, 8).map((g) => ({
          messageKind: g.messageKind,
          nextPromotionDueAt: g.nextPromotionDueAt,
          hasAttempt2: !!g.attempt2BatchId,
          hasAttempt3: !!g.attempt3BatchId
        }))
      },
      _cohortSubmissionIds: cohortIds
    }
  };
}

async function computeRecipientMonthTrend({ monthIso, messageKind = null, opsProduct = null }) {
  const s = String(monthIso || '').trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return { error: 'Invalid month YYYY-MM' };
  const [y, m] = s.split('-').map((x) => parseInt(x, 10));
  const pad = (n) => String(n).padStart(2, '0');
  const lastD = new Date(y, m, 0).getDate();
  const dayMin = `${y}-${pad(m)}-01`;
  const dayMax = `${y}-${pad(m)}-${pad(lastD)}`;

  const effKind = effectiveOverviewMessageKind(opsProduct, messageKind);
  const annotate = annotateEventsWithSlotDayPipeline(effKind, opsProduct);
  const monthSlotMatch = { $match: { slotDayIst: { $gte: dayMin, $lte: dayMax, $ne: null } } };

  const perRecipientDay = await WhatsAppMessageEvent.aggregate([
    ...annotate,
    { $match: { slotDayIst: { $ne: null } } },
    monthSlotMatch,
    {
      $group: {
        _id: {
          day: '$slotDayIst',
          lineageId: '$lineageId',
          phone: '$phone',
          messageKind: '$messageKind'
        },
        everDelivered: { $max: { $cond: [{ $in: ['$status', DELIVERED_PLUS] }, 1, 0] } },
        anyReconcilePending: {
          $max: { $cond: [{ $in: ['$status', RECONCILE_PENDING] }, 1, 0] }
        },
        anyPermanent: {
          $max: {
            $cond: [
              {
                $or: [
                  { $eq: ['$terminalFailureKind', 'permanent'] },
                  { $eq: ['$retryExclusionReason', 'permanent_failure'] },
                  { $eq: ['$retryExclusionReason', 'policy_non_retryable'] }
                ]
              },
              1,
              0
            ]
          }
        },
        anyExhausted: { $max: { $cond: [{ $eq: ['$status', 'retry_exhausted'] }, 1, 0] } },
        anyInFlight: { $max: { $cond: [{ $in: ['$status', IN_FLIGHT] }, 1, 0] } },
        anyTerminalFail: { $max: { $cond: [{ $in: ['$status', TERMINAL_FAILURE] }, 1, 0] } }
      }
    },
    {
      $addFields: {
        finalPermanentFailed: {
          $cond: [
            {
              $and: [
                { $eq: ['$everDelivered', 0] },
                { $or: [{ $eq: ['$anyPermanent', 1] }, { $eq: ['$anyExhausted', 1] }] }
              ]
            },
            1,
            0
          ]
        },
        finalUnresolved: {
          $cond: [
            {
              $and: [
                { $eq: ['$everDelivered', 0] },
                {
                  $or: [
                    { $eq: ['$anyReconcilePending', 1] },
                    { $eq: ['$anyInFlight', 1] },
                    { $eq: ['$anyTerminalFail', 1] }
                  ]
                }
              ]
            },
            1,
            0
          ]
        }
      }
    }
  ]);

  const byDay = new Map();
  for (const r of perRecipientDay) {
    const day = r._id?.day;
    if (!day) continue;
    if (!byDay.has(day)) {
      byDay.set(day, {
        _id: day,
        delivered: 0,
        permanentFailed: 0,
        reconcilePending: 0,
        transientUnresolved: 0,
        unresolved: 0,
        totalRecipients: 0
      });
    }
    const d = byDay.get(day);
    d.totalRecipients += 1;
    if (r.everDelivered) d.delivered += 1;
    else if (r.finalPermanentFailed) d.permanentFailed += 1;
    else if (r.anyReconcilePending) d.reconcilePending += 1;
    else if (r.finalUnresolved && !r.anyReconcilePending && !r.finalPermanentFailed) {
      d.transientUnresolved += 1;
    }
    d.unresolved = d.transientUnresolved;
  }

  const days = [...byDay.values()].sort((a, b) => String(a._id).localeCompare(String(b._id)));

  return {
    data: {
      ...canonical.buildAnalyticsMeta(),
      days
    }
  };
}

/**
 * Recipient-primary range rollup across IST slot-days (per slot-day cohort, not globally deduped).
 */
async function computeRecipientRangeSummary({
  from,
  to,
  messageKind = null,
  opsProduct = null
} = {}) {
  if (!from || !to) return { error: 'from and to dates required' };
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);
  const days = [];
  let cur = new Date(`${fromIso}T00:00:00.000Z`);
  const end = new Date(`${toIso}T00:00:00.000Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const dayResults = await Promise.all(
    days.map((dateIso) =>
      computeRecipientDayOverview({ dateIso, messageKind, slotTime: 'all', opsProduct })
    )
  );

  const rangeDays = [];
  const sum = {
    totalRecipients: 0,
    delivered: 0,
    read: 0,
    accepted: 0,
    finalPermanentFailed: 0,
    reconcilePending: 0,
    transientUnresolved: 0,
    excluded: 0
  };

  dayResults.forEach((r, i) => {
    if (r.error) return;
    const rt = r.data?.recipientTotals || {};
    rangeDays.push({
      date: days[i],
      totalRecipients: rt.totalRecipients || 0,
      delivered: rt.delivered || 0,
      permanentFailed: rt.finalPermanentFailed || 0,
      reconcilePending: rt.reconcilePending || 0,
      transientUnresolved: rt.transientUnresolved || 0,
      unresolved: rt.transientUnresolved || 0
    });
    sum.totalRecipients += rt.totalRecipients || 0;
    sum.delivered += rt.delivered || 0;
    sum.read += rt.read || 0;
    sum.accepted += rt.accepted || 0;
    sum.finalPermanentFailed += rt.finalPermanentFailed || 0;
    sum.reconcilePending += rt.reconcilePending || 0;
    sum.transientUnresolved += rt.transientUnresolved || 0;
    sum.excluded += rt.excludedTotal || rt.excluded || 0;
  });

  return {
    data: {
      ...canonical.buildAnalyticsMeta({
        rangeNote:
          'Range totals sum per IST slot-day cohorts; the same phone on two slot days counts twice.'
      }),
      range: { from, to },
      recipientTotals: {
        ...sum,
        finalFailed: sum.finalPermanentFailed,
        excludedTotal: sum.excluded
      },
      days: rangeDays
    }
  };
}

async function computeFailureReasonDistribution({
  from,
  to,
  messageKind = null,
  formSubmissionIds = null,
  iitCounsellingSubmissionIds = null,
  cohortSlotDayIso = null,
  opsProduct = null
}) {
  if (cohortSlotDayIso) {
    const annotate = annotateEventsWithSlotDayPipeline(messageKind, opsProduct);
    let cohortSteps = [];
    if (formSubmissionIds && formSubmissionIds.length) {
      cohortSteps = [{ $match: { formSubmissionId: { $in: formSubmissionIds } } }];
    } else if (iitCounsellingSubmissionIds && iitCounsellingSubmissionIds.length) {
      cohortSteps = [{ $match: { iitCounsellingSubmissionId: { $in: iitCounsellingSubmissionIds } } }];
    }
    const recipientRows = await WhatsAppMessageEvent.aggregate([
      ...annotate,
      { $match: { slotDayIst: cohortSlotDayIso } },
      ...cohortSteps,
      ...canonical.buildRecipientRollupPipelineStages(!!messageKind)
    ]);
    return canonical.buildRecipientFailureReasonBreakdown(recipientRows);
  }

  const match = {
    status: { $in: TERMINAL_FAILURE },
    ...matchWhatsAppEventsByOpsProduct(parseOpsProductQuery(opsProduct)),
    ...(!(formSubmissionIds && formSubmissionIds.length)
      && !(iitCounsellingSubmissionIds && iitCounsellingSubmissionIds.length)
      && (from || to)
      ? {
          createdAt: {
            ...(from ? { $gte: from } : {}),
            ...(to ? { $lte: to } : {})
          }
        }
      : {}),
    ...(messageKind ? { messageKind } : {}),
    ...(formSubmissionIds && formSubmissionIds.length
      ? { formSubmissionId: { $in: formSubmissionIds } }
      : {}),
    ...(iitCounsellingSubmissionIds && iitCounsellingSubmissionIds.length
      ? { iitCounsellingSubmissionId: { $in: iitCounsellingSubmissionIds } }
      : {})
  };
  const rows = await WhatsAppMessageEvent.aggregate([
    { $match: match },
    {
      $project: {
        bucket: {
          $switch: {
            branches: [
              {
                case: {
                  $regexMatch: {
                    input: { $ifNull: ['$webhookErrorReason', ''] },
                    regex: /invalid|no whatsapp|not whatsapp|disabled/i
                  }
                },
                then: 'invalid_whatsapp'
              },
              {
                case: {
                  $regexMatch: {
                    input: { $ifNull: ['$webhookErrorReason', ''] },
                    regex: /blocked|opt.?out/i
                  }
                },
                then: 'user_blocked'
              },
              {
                case: {
                  $regexMatch: {
                    input: { $ifNull: ['$errorMessage', ''] },
                    regex: /timeout|network|temporar/i
                  }
                },
                then: 'transient'
              },
              {
                case: { $eq: ['$retryExclusionReason', 'dlr_failed_after_accept'] },
                then: 'dlr_failed_after_accept'
              },
              {
                case: { $eq: ['$retryExclusionReason', 'webhook_stale_unresolved'] },
                then: 'webhook_stale_unresolved'
              },
              {
                case: { $eq: ['$retryExclusionReason', 'permanent_failure'] },
                then: 'permanent_failure'
              }
            ],
            default: 'other'
          }
        }
      }
    },
    { $group: { _id: '$bucket', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  return rows;
}

async function computeTemplateReliabilityRanking({
  from,
  to,
  formSubmissionIds = null,
  iitCounsellingSubmissionIds = null,
  opsProduct = null
}) {
  const match = {
    ...matchWhatsAppEventsByOpsProduct(parseOpsProductQuery(opsProduct)),
    ...(!(formSubmissionIds && formSubmissionIds.length)
      && !(iitCounsellingSubmissionIds && iitCounsellingSubmissionIds.length)
      && (from || to)
      ? {
          createdAt: {
            ...(from ? { $gte: from } : {}),
            ...(to ? { $lte: to } : {})
          }
        }
      : {}),
    ...(formSubmissionIds && formSubmissionIds.length
      ? { formSubmissionId: { $in: formSubmissionIds } }
      : {}),
    ...(iitCounsellingSubmissionIds && iitCounsellingSubmissionIds.length
      ? { iitCounsellingSubmissionId: { $in: iitCounsellingSubmissionIds } }
      : {})
  };
  const rows = await WhatsAppMessageEvent.aggregate([
    { $match: match },
    {
      $addFields: {
        lineageId: { $ifNull: ['$canonicalRetryGroupId', '$retryGroupId'] }
      }
    },
    {
      $group: {
        _id: { kind: '$messageKind', lineageId: '$lineageId', phone: '$phone' },
        delivered: { $max: { $cond: [{ $in: ['$status', DELIVERED_PLUS] }, 1, 0] } },
        read: { $max: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
        attempt1Fail: {
          $max: {
            $cond: [
              {
                $and: [
                  { $eq: ['$attemptNumber', 1] },
                  { $in: ['$status', TERMINAL_FAILURE] }
                ]
              },
              1,
              0
            ]
          }
        },
        laterDelivered: {
          $max: {
            $cond: [
              {
                $and: [
                  { $gt: ['$attemptNumber', 1] },
                  { $in: ['$status', DELIVERED_PLUS] }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $group: {
        _id: '$_id.kind',
        recipients: { $sum: 1 },
        delivered: { $sum: '$delivered' },
        read: { $sum: '$read' },
        attempt1Fails: { $sum: '$attempt1Fail' },
        recoveredAfterFail: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$attempt1Fail', 1] }, { $eq: ['$laterDelivered', 1] }] },
              1,
              0
            ]
          }
        }
      }
    }
  ]);

  return (rows || []).map((r) => ({
    kind: r._id,
    deliveryRatePct: divPct(r.delivered, r.recipients),
    readRatePct: divPct(r.read, r.recipients),
    recoveryRatePct: divPct(r.recoveredAfterFail, r.attempt1Fails || 1),
    recipients: r.recipients,
    delivered: r.delivered,
    read: r.read
  }));
}

/**
 * Data-quality counters for a slot-day cohort (IST). Intended for admin debug (`?debug=1`).
 */
async function computeCohortDayDiagnostics({
  dateIso,
  messageKind = null,
  cohortSubmissionIds = [],
  opsProduct = null
} = {}) {
  const range = istDayRangeFromIso(dateIso);
  if (!range) return { error: 'Invalid date format. Use YYYY-MM-DD' };
  if (!Array.isArray(cohortSubmissionIds) || cohortSubmissionIds.length === 0) {
    const off0 = getReminderOffsetsMsForDiagnostics();
    return {
      data: {
        cohortSlotDayIso: range.isoDate,
        orphanSubmissionsMissingSlotDay: 0,
        duplicateRetryAttemptKeys: 0,
        sendsBeforeEligibility: 0,
        sendsAtOrAfterSlotStart: 0,
        persistedSentTooEarlyCount: 0,
        persistedSentAfterExpiryCount: 0,
        eligibilityTimingBlockedCount: 0,
        violationSamples: [],
        violationsByAttemptSource: [],
        sendsBeforeEligibilityBySlotSuffix: [],
        offsetsMsUsed: {
          pre4hr: Number(off0.pre4hr) || 0,
          meet: Number(off0.meet) || 0,
          min30: Number(off0.min30) || 0
        },
        note: 'empty_cohort'
      }
    };
  }

  const ids = cohortSubmissionIds.filter((id) => id != null);
  const off = getReminderOffsetsMsForDiagnostics();
  const pre4ms = Number(off.pre4hr) || 0;
  const meetms = Number(off.meet) || 0;
  const min30ms = Number(off.min30) || 0;
  const kindMatch = messageKind ? { messageKind } : {};

  const opsSlug = parseOpsProductQuery(opsProduct);
  const idField = opsSlug === 'iit_counselling' ? 'iitCounsellingSubmissionId' : 'formSubmissionId';
  const cohortKeyMatch = {
    ...kindMatch,
    [idField]: { $in: ids },
    ...matchWhatsAppEventsByOpsProduct(opsSlug)
  };

  const [orphanSubmissionsMissingSlotDay] = await WhatsAppMessageEvent.aggregate([
    { $match: cohortKeyMatch },
    ...annotateEventsWithSlotDayPipeline(messageKind, opsProduct),
    { $match: { slotDayIst: null } },
    { $count: 'c' }
  ]);

  const [duplicateRetryAttemptKeys] = await WhatsAppMessageEvent.aggregate([
    {
      $match: {
        ...cohortKeyMatch,
        retryGroupId: { $ne: null, $exists: true },
        attemptNumber: { $gte: 1, $lte: 3 }
      }
    },
    {
      $group: {
        _id: { g: '$retryGroupId', p: '$phone', a: '$attemptNumber' },
        n: { $sum: 1 }
      }
    },
    { $match: { n: { $gt: 1 } } },
    { $count: 'c' }
  ]);

  const [timing] = await WhatsAppMessageEvent.aggregate([
    { $match: cohortKeyMatch },
    ...annotateEventsWithSlotDayPipeline(messageKind, opsProduct),
    { $match: { slotDayIst: range.isoDate, slotDateFromSub: { $ne: null } } },
    {
      $addFields: {
        earliestAllowedAt: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$messageKind', 'pre4hr'] },
                then: { $subtract: ['$slotDateFromSub', pre4ms] }
              },
              {
                case: { $eq: ['$messageKind', 'meet'] },
                then: { $subtract: ['$slotDateFromSub', meetms] }
              },
              {
                case: { $eq: ['$messageKind', '30min'] },
                then: { $subtract: ['$slotDateFromSub', min30ms] }
              }
            ],
            default: null
          }
        }
      }
    },
    {
      $addFields: {
        sendsBeforeEligibility: {
          $cond: [
            {
              $and: [
                { $ne: ['$earliestAllowedAt', null] },
                { $lt: ['$createdAt', '$earliestAllowedAt'] }
              ]
            },
            1,
            0
          ]
        },
        sendsAtOrAfterSlotStart: {
          $cond: [
            {
              $and: [{ $ne: ['$slotDateFromSub', null] }, { $gte: ['$createdAt', '$slotDateFromSub'] }]
            },
            1,
            0
          ]
        }
      }
    },
    {
      $group: {
        _id: null,
        sendsBeforeEligibility: { $sum: '$sendsBeforeEligibility' },
        sendsAtOrAfterSlotStart: { $sum: '$sendsAtOrAfterSlotStart' }
      }
    }
  ]);

  const t = timing && timing[0] ? timing[0] : {};

  const persistedMatch = {
    ...cohortKeyMatch,
    messageKind: { $in: ['pre4hr', 'meet', '30min'] }
  };

  const [[persistedEarly], [persistedAfterExpiry], [timingBlockedCount], violationSamples] =
    await Promise.all([
      WhatsAppMessageEvent.aggregate([
        { $match: { ...persistedMatch, 'eligibilityTiming.sentTooEarly': true } },
        { $count: 'c' }
      ]),
      WhatsAppMessageEvent.aggregate([
        { $match: { ...persistedMatch, 'eligibilityTiming.sentAfterExpiry': true } },
        { $count: 'c' }
      ]),
      WhatsAppMessageEvent.aggregate([
        { $match: { ...persistedMatch, retryExclusionReason: 'eligibility_timing_blocked' } },
        { $count: 'c' }
      ]),
      WhatsAppMessageEvent.aggregate([
        { $match: cohortKeyMatch },
        ...annotateEventsWithSlotDayPipeline(messageKind, opsProduct),
        { $match: { slotDayIst: range.isoDate } },
        {
          $match: {
            $or: [
              { 'eligibilityTiming.sentTooEarly': true },
              { 'eligibilityTiming.sentAfterExpiry': true },
              { retryExclusionReason: 'eligibility_timing_blocked' }
            ]
          }
        },
        { $sort: { createdAt: -1 } },
        { $limit: 15 },
        {
          $project: {
            phone: 1,
            messageKind: 1,
            attemptNumber: 1,
            source: 1,
            status: 1,
            createdAt: 1,
            eligibilityTiming: 1,
            retryExclusionReason: 1,
            errorMessage: 1
          }
        }
      ])
    ]);

  const violationsByAttemptSource = await WhatsAppMessageEvent.aggregate([
    { $match: cohortKeyMatch },
    ...annotateEventsWithSlotDayPipeline(messageKind, opsProduct),
    { $match: { slotDayIst: range.isoDate, slotDateFromSub: { $ne: null } } },
    {
      $addFields: {
        earliestAllowedAt: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$messageKind', 'pre4hr'] },
                then: { $subtract: ['$slotDateFromSub', pre4ms] }
              },
              {
                case: { $eq: ['$messageKind', 'meet'] },
                then: { $subtract: ['$slotDateFromSub', meetms] }
              },
              {
                case: { $eq: ['$messageKind', '30min'] },
                then: { $subtract: ['$slotDateFromSub', min30ms] }
              }
            ],
            default: null
          }
        }
      }
    },
    {
      $match: {
        $or: [
          {
            $and: [{ $ne: ['$earliestAllowedAt', null] }, { $lt: ['$createdAt', '$earliestAllowedAt'] }]
          },
          { 'eligibilityTiming.sentTooEarly': true },
          { retryExclusionReason: 'eligibility_timing_blocked' }
        ]
      }
    },
    {
      $group: {
        _id: { attempt: '$attemptNumber', source: '$source' },
        n: { $sum: 1 }
      }
    },
    { $sort: { '_id.attempt': 1, '_id.source': 1 } }
  ]);

  const slotSuffixDiagnostics =
    opsSlug === 'iit_counselling'
      ? []
      : await Promise.all(
          ALLOWED_SLOT_TIME_SUFFIXES.map(async (suffix) => {
      const slotRe = new RegExp(`_${suffix}$`);
      const subIds = await FormSubmission.distinct('_id', {
        isRegistered: true,
        'step3Data.slotDate': { $gte: range.from, $lte: range.to },
        'step3Data.selectedSlot': slotRe
      });
      if (!subIds.length) {
        return { slotTime: suffix, sendsBeforeEligibility: 0, note: 'no_bookings' };
      }
      const [row] = await WhatsAppMessageEvent.aggregate([
        {
          $match: {
            ...kindMatch,
            formSubmissionId: { $in: subIds },
            ...matchWhatsAppEventsByOpsProduct(opsSlug)
          }
        },
        ...annotateEventsWithSlotDayPipeline(messageKind, opsProduct),
        { $match: { slotDayIst: range.isoDate, slotDateFromSub: { $ne: null } } },
        {
          $addFields: {
            earliestAllowedAt: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$messageKind', 'pre4hr'] },
                    then: { $subtract: ['$slotDateFromSub', pre4ms] }
                  },
                  {
                    case: { $eq: ['$messageKind', 'meet'] },
                    then: { $subtract: ['$slotDateFromSub', meetms] }
                  },
                  {
                    case: { $eq: ['$messageKind', '30min'] },
                    then: { $subtract: ['$slotDateFromSub', min30ms] }
                  }
                ],
                default: null
              }
            }
          }
        },
        {
          $addFields: {
            sendsBeforeEligibility: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$earliestAllowedAt', null] },
                    { $lt: ['$createdAt', '$earliestAllowedAt'] }
                  ]
                },
                1,
                0
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            sendsBeforeEligibility: { $sum: '$sendsBeforeEligibility' }
          }
        }
      ]);
      return {
        slotTime: suffix,
        sendsBeforeEligibility: row && row.sendsBeforeEligibility ? row.sendsBeforeEligibility : 0
      };
    })
  );

  const lifecycleMatch = {
    ...cohortKeyMatch,
    ...(messageKind ? { messageKind } : {})
  };
  const cohortPhones = await distinctPhone10ForCohort(ids, opsSlug);
  const [statusBreakdown, missingAllProviderIds, webhookQuarantine] = await Promise.all([
    WhatsAppMessageEvent.aggregate([
      { $match: lifecycleMatch },
      ...annotateEventsWithSlotDayPipeline(messageKind, opsProduct),
      { $match: { slotDayIst: range.isoDate } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    WhatsAppMessageEvent.aggregate([
      { $match: lifecycleMatch },
      ...annotateEventsWithSlotDayPipeline(messageKind, opsProduct),
      { $match: { slotDayIst: range.isoDate } },
      {
        $match: {
          gupshupMessageId: null,
          gupshupInternalMessageId: null,
          whatsappWaMessageId: null
        }
      },
      { $count: 'c' }
    ]),
    WhatsAppWebhookEvent.aggregate([
      {
        $match: {
          receivedAt: { $gte: range.from, $lte: range.to },
          ...(cohortPhones.length ? { phone: { $in: cohortPhones } } : {})
        }
      },
      {
        $group: {
          _id: { quarantined: '$isQuarantined', reason: '$quarantineReason' },
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  return {
    data: {
      cohortSlotDayIso: range.isoDate,
      orphanSubmissionsMissingSlotDay: orphanSubmissionsMissingSlotDay?.c || 0,
      duplicateRetryAttemptKeys: duplicateRetryAttemptKeys?.c || 0,
      sendsBeforeEligibility: t.sendsBeforeEligibility || 0,
      sendsAtOrAfterSlotStart: t.sendsAtOrAfterSlotStart || 0,
      offsetsMsUsed: { pre4hr: pre4ms, meet: meetms, min30: min30ms },
      persistedSentTooEarlyCount: persistedEarly?.c || 0,
      persistedSentAfterExpiryCount: persistedAfterExpiry?.c || 0,
      eligibilityTimingBlockedCount: timingBlockedCount?.c || 0,
      violationSamples: violationSamples || [],
      violationsByAttemptSource: violationsByAttemptSource || [],
      sendsBeforeEligibilityBySlotSuffix: slotSuffixDiagnostics,
      lifecycleDiagnostics: {
        eventStatusBreakdown: statusBreakdown || [],
        eventsMissingAllProviderIds: missingAllProviderIds?.[0]?.c || 0,
        webhookQuarantineBreakdown: webhookQuarantine || [],
        note:
          'High missingAllProviderIds or quarantined webhooks usually explain 0 delivered with messages received on handset.'
      }
    }
  };
}

/** @param {Array<unknown>} cohortSubmissionIds @param {'guidexpert'|'iit_counselling'} opsSlug */
async function distinctPhone10ForCohort(cohortSubmissionIds, opsSlug) {
  if (!cohortSubmissionIds.length) return [];
  const norm = (list) =>
    list.map((p) => String(p).replace(/\D/g, '').slice(-10)).filter((p) => p.length === 10);
  if (opsSlug === 'iit_counselling') {
    const phones = await IitCounsellingSubmission.distinct('phone', { _id: { $in: cohortSubmissionIds } });
    return norm(phones);
  }
  const gxPhones = await FormSubmission.distinct('phone', { _id: { $in: cohortSubmissionIds } });
  return norm(gxPhones);
}

/**
 * Side-by-side recipient KPIs per wall-clock slot suffix (same IST booking day).
 */
async function computeRecipientSlotTimeBreakdown({ dateIso, messageKind = null, opsProduct = null }) {
  const slots = [...ALLOWED_SLOT_TIME_SUFFIXES];
  const entries = await Promise.all(
    slots.map(async (suffix) => {
      const r = await computeRecipientDayOverview({
        dateIso,
        messageKind,
        slotTime: suffix,
        opsProduct
      });
      if (r.error) return { slotTime: suffix, error: r.error };
      const d = r.data;
      return {
        slotTime: suffix,
        bookedSlotsCount: d.bookedSlotsCount,
        recipientTotals: d.recipientTotals,
        retryFunnelByAttempt: d.retryFunnelByAttempt,
        filter: d.filter
      };
    })
  );
  const bySlotTime = {};
  entries.forEach((e) => {
    bySlotTime[e.slotTime] = e;
  });
  return { data: { bySlotTime, slots } };
}

/**
 * One CSV row per recipient for IST slot-day cohort (matches overview buckets).
 */
async function computeRecipientSummaryExportRows({
  dateIso,
  messageKind = null,
  slotTime = 'all',
  opsProduct = null
} = {}) {
  const overview = await computeRecipientDayOverview({ dateIso, messageKind, slotTime, opsProduct });
  if (overview.error) return overview;
  const filter = overview.data?.filter || {};
  const range = istDayRangeFromIso(dateIso);
  if (!range) return { error: 'Invalid date format. Use YYYY-MM-DD' };
  const slotTimeNorm = normalizeSlotTimeParam(slotTime);
  const opsSlug = parseOpsProductQuery(opsProduct);
  const effKind = effectiveOverviewMessageKind(opsProduct, messageKind);
  const cohortFilter =
    opsSlug === 'iit_counselling'
      ? buildIitBookingCohortFilter(range, slotTimeNorm)
      : buildBookingCohortFilter(range, slotTimeNorm);
  const cohortIds =
    opsSlug === 'iit_counselling'
      ? await IitCounsellingSubmission.distinct('_id', cohortFilter)
      : await FormSubmission.distinct('_id', cohortFilter);
  const idField = opsSlug === 'iit_counselling' ? 'iitCounsellingSubmissionId' : 'formSubmissionId';
  const annotate = annotateEventsWithSlotDayPipeline(effKind, opsProduct);
  const recipientRows = await WhatsAppMessageEvent.aggregate([
    ...annotate,
    { $match: { slotDayIst: { $ne: null } } },
    { $match: { slotDayIst: filter.date || dateIso } },
    { $match: { [idField]: { $in: cohortIds } } },
    ...canonical.buildRecipientRollupPipelineStages(!!messageKind)
  ]);
  const rows = (recipientRows || []).map((r) => {
    const id = r._id || {};
    return {
      slotDayIst: filter.date || dateIso,
      phone: id.phone || '',
      messageKind: id.messageKind || messageKind || '',
      lineageId: id.lineageId != null ? String(id.lineageId) : '',
      canonicalBucket: canonical.assignRecipientBucket(r),
      canonicalExclusionReason: canonical.toCanonicalExclusionReason(r) || '',
      canonicalFailureReason: canonical.toCanonicalFailureReason(r) || '',
      everDelivered: Boolean(r.everDelivered),
      finalPermanentFailed: Boolean(r.finalPermanentFailed),
      reconcilePending: Boolean(r.anyReconcilePending),
      transientUnresolved: Boolean(
        r.finalUnresolved && !r.anyReconcilePending && !r.finalPermanentFailed
      )
    };
  });
  return { data: { filter, recipientTotals: overview.data?.recipientTotals, rows } };
}

/**
 * IIT counselling: booked + delivery KPIs per preferred language (Telugu / Hindi / unknown).
 */
async function computeRecipientLanguageBreakdown({
  dateIso,
  messageKind = null,
  slotTime = 'all',
  opsProduct = null,
} = {}) {
  const opsSlug = parseOpsProductQuery(opsProduct);
  if (opsSlug !== 'iit_counselling') {
    return { data: { byLanguage: {} } };
  }
  const slotTimeNorm = normalizeSlotTimeParam(slotTime);
  if (slotTimeNorm === null) {
    return { error: `Invalid slotTime. Allowed: all, ${ALLOWED_SLOT_TIME_SUFFIXES.join(', ')}` };
  }
  const range = istDayRangeFromIso(dateIso);
  if (!range) return { error: 'Invalid date format. Use YYYY-MM-DD' };

  const effKind = effectiveOverviewMessageKind(opsProduct, messageKind);
  const annotate = annotateEventsWithSlotDayPipeline(effKind, opsProduct);
  const slotDayMatch = { $match: { slotDayIst: range.isoDate } };
  const byLanguage = {};

  for (const lang of IIT_LANGUAGE_BUCKETS) {
    let cohortFilter = buildIitBookingCohortFilter(range, slotTimeNorm);
    if (lang === 'Telugu' || lang === 'Hindi') {
      cohortFilter = {
        ...cohortFilter,
        'iitCounselling.section2Data.preferredLanguage': lang,
      };
    } else {
      cohortFilter = {
        $and: [
          cohortFilter,
          {
            $or: [
              { 'iitCounselling.section2Data.preferredLanguage': { $exists: false } },
              { 'iitCounselling.section2Data.preferredLanguage': null },
              { 'iitCounselling.section2Data.preferredLanguage': '' },
            ],
          },
        ],
      };
    }

    const [booked, cohortIds] = await Promise.all([
      IitCounsellingSubmission.countDocuments(cohortFilter),
      IitCounsellingSubmission.distinct('_id', cohortFilter),
    ]);

    let recipientTotals = null;
    if (messageKind && cohortIds.length > 0) {
      const rows = await WhatsAppMessageEvent.aggregate([
        ...annotate,
        { $match: { slotDayIst: { $ne: null } } },
        slotDayMatch,
        { $match: { iitCounsellingSubmissionId: { $in: cohortIds } } },
        ...canonical.buildRecipientRollupPipelineStages(true),
      ]);
      recipientTotals = canonical.rollupRecipientTotals(rows || []);
    }

    byLanguage[lang] = { booked, recipientTotals };
  }

  return {
    data: {
      byLanguage,
      filter: { date: range.isoDate, slotTime: slotTimeNorm, messageKind: effKind || messageKind },
    },
  };
}

module.exports = {
  ALLOWED_MESSAGE_KINDS,
  ALLOWED_SLOT_TIME_SUFFIXES,
  normalizeSlotTimeParam,
  buildRecipientOutcomeBreakdown,
  computeRecipientDayOverview,
  computeRecipientMonthTrend,
  computeRecipientRangeSummary,
  computeRecipientSummaryExportRows,
  computeFailureReasonDistribution,
  computeTemplateReliabilityRanking,
  computeCohortDayDiagnostics,
  computeRecipientSlotTimeBreakdown,
  computeRecipientLanguageBreakdown,
  IIT_LANGUAGE_BUCKETS,
  istDayRangeFromIso,
  annotateEventsWithSlotDayPipeline
};
