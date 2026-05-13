/**
 * Deterministic recipient-based WhatsApp ops analytics (booking cohort: IST slot calendar day
 * + optional slot time, FormSubmission-backed). All-templates rollup groups by phone across message kinds.
 */
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
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

const ALLOWED_MESSAGE_KINDS = ['slot_booked', 'pre4hr', 'meet', '30min'];
const ALLOWED_SLOT_TIME_SUFFIXES = ['11AM', '3PM', '6PM', '7PM'];
const ACCEPTED_STATUSES = ['submitted', 'sent', 'delivered', 'read'];
const SENT_PLUS = ['sent', 'delivered', 'read'];
const DELIVERED_PLUS = ['delivered', 'read'];
const TERMINAL_FAILURE = ['failed', 'retry_exhausted'];
const IN_FLIGHT = ['queued', 'submitted', 'sent', 'retry_pending'];

function divPct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

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

  const recipientGroupId = messageKind
    ? { lineageId: '$lineageId', phone: '$phone', messageKind: '$messageKind' }
    : { phone: '$phone' };

  const baseAfterAnnotate = [
    ...annotate,
    { $match: { slotDayIst: { $ne: null } } },
    slotDayMatch,
    cohortMatch
  ];

  const recipientRollupStages = [
    ...baseAfterAnnotate,
    {
      $group: {
        _id: recipientGroupId,
        maxAttempt: { $max: '$attemptNumber' },
        everDelivered: {
          $max: { $cond: [{ $in: ['$status', DELIVERED_PLUS] }, 1, 0] }
        },
        everRead: { $max: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
        everAccepted: { $max: { $cond: [{ $in: ['$status', ACCEPTED_STATUSES] }, 1, 0] } },
        anyTerminalFail: {
          $max: { $cond: [{ $in: ['$status', TERMINAL_FAILURE] }, 1, 0] }
        },
        anyExhausted: { $max: { $cond: [{ $eq: ['$status', 'retry_exhausted'] }, 1, 0] } },
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
        anyExcluded: { $max: { $cond: [{ $ne: ['$retryExclusionReason', null] }, 1, 0] } },
        anyInFlight: {
          $max: { $cond: [{ $in: ['$status', IN_FLIGHT] }, 1, 0] }
        },
        cohortFallback: { $max: { $cond: [{ $eq: ['$cohortFallback', true] }, 1, 0] } }
      }
    },
    {
      $addFields: {
        finalPermanentFailed: {
          $cond: [
            {
              $and: [
                { $eq: ['$everDelivered', 0] },
                {
                  $or: [
                    { $eq: ['$anyPermanent', 1] },
                    { $eq: ['$anyExhausted', 1] }
                  ]
                }
              ]
            },
            1,
            0
          ]
        }
      }
    },
    {
      $addFields: {
        finalUnresolved: {
          $cond: [
            {
              $and: [
                { $eq: ['$everDelivered', 0] },
                { $eq: ['$finalPermanentFailed', 0] },
                {
                  $or: [
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
  ];

  const funnelRowId = messageKind
    ? { attempt: '$attemptNumber', lineageId: '$lineageId', phone: '$phone', messageKind: '$messageKind' }
    : { attempt: '$attemptNumber', phone: '$phone' };

  const [recipientRows, exclusionRows, groupSchedule] = await Promise.all([
    WhatsAppMessageEvent.aggregate(recipientRollupStages),
    WhatsAppMessageEvent.aggregate([
      ...baseAfterAnnotate,
      { $match: { retryExclusionReason: { $ne: null } } },
      { $group: { _id: '$retryExclusionReason', count: { $sum: 1 } } }
    ]),
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
  const totals = recipients.reduce(
    (acc, r) => ({
      totalRecipients: acc.totalRecipients + 1,
      accepted: acc.accepted + (r.everAccepted ? 1 : 0),
      delivered: acc.delivered + (r.everDelivered ? 1 : 0),
      read: acc.read + (r.everRead ? 1 : 0),
      finalUnresolved: acc.finalUnresolved + (r.finalUnresolved ? 1 : 0),
      finalPermanentFailed: acc.finalPermanentFailed + (r.finalPermanentFailed ? 1 : 0),
      cohortFallbackCount: acc.cohortFallbackCount + (r.cohortFallback ? 1 : 0)
    }),
    {
      totalRecipients: 0,
      accepted: 0,
      delivered: 0,
      read: 0,
      finalUnresolved: 0,
      finalPermanentFailed: 0,
      cohortFallbackCount: 0
    }
  );

  const exclusionByReason = {};
  (exclusionRows || []).forEach((x) => {
    exclusionByReason[x._id || 'unknown'] = x.count || 0;
  });

  const funnelStages = await WhatsAppMessageEvent.aggregate([
    ...baseAfterAnnotate,
    {
      $group: {
        _id: funnelRowId,
        accepted: {
          $max: { $cond: [{ $in: ['$status', ACCEPTED_STATUSES] }, 1, 0] }
        },
        sent: { $max: { $cond: [{ $in: ['$status', SENT_PLUS] }, 1, 0] } },
        delivered: { $max: { $cond: [{ $in: ['$status', DELIVERED_PLUS] }, 1, 0] } },
        read: { $max: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
        failed: { $max: { $cond: [{ $in: ['$status', TERMINAL_FAILURE] }, 1, 0] } },
        inFlight: { $max: { $cond: [{ $in: ['$status', IN_FLIGHT] }, 1, 0] } },
        excluded: { $max: { $cond: [{ $ne: ['$retryExclusionReason', null] }, 1, 0] } }
      }
    },
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

  const byAttempt = { 1: {}, 2: {}, 3: {} };
  [1, 2, 3].forEach((n) => {
    const row = funnelStages.find((x) => x._id === n) || {};
    const t = row.targetedRecipients || 0;
    byAttempt[n] = {
      targetedRecipients: t,
      accepted: row.accepted || 0,
      sent: row.sent || 0,
      delivered: row.delivered || 0,
      read: row.read || 0,
      failed: row.failed || 0,
      inFlight: row.inFlight || 0,
      excluded: row.excluded || 0,
      successRatePct: divPct(row.delivered || 0, t)
    };
  });

  const nextDue = groupSchedule.length ? groupSchedule[0].nextPromotionDueAt : null;

  return {
    data: {
      schemaVersion: 2,
      cohortAnchor: 'booking_ist_slot_day',
      filter: { date: range.isoDate, messageKind: messageKind || null, slotTime: slotTimeNorm, opsProduct: opsSlug },
      range: { from: range.from, to: range.to },
      bookedSlotsCount: cohortBookedCount,
      recipientTotals: {
        ...totals,
        bookedWithoutAnyWaEvent,
        excludedTotal: Object.values(exclusionByReason).reduce((a, b) => a + b, 0)
      },
      exclusionBreakdown: exclusionByReason,
      retryFunnelByAttempt: byAttempt,
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

  const simplified = await WhatsAppMessageEvent.aggregate([
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
        anyFail: { $max: { $cond: [{ $in: ['$status', TERMINAL_FAILURE] }, 1, 0] } },
        anyPerm: {
          $max: {
            $cond: [
              {
                $or: [
                  { $eq: ['$terminalFailureKind', 'permanent'] },
                  { $eq: ['$retryExclusionReason', 'permanent_failure'] }
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
        _id: '$_id.day',
        delivered: {
          $sum: { $cond: [{ $eq: ['$everDelivered', 1] }, 1, 0] }
        },
        permanentFailed: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$everDelivered', 0] }, { $eq: ['$anyPerm', 1] }] },
              1,
              0
            ]
          }
        },
        unresolved: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$everDelivered', 0] },
                  { $eq: ['$anyPerm', 0] },
                  { $eq: ['$anyFail', 1] }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return { data: { days: simplified } };
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
    const rows = await WhatsAppMessageEvent.aggregate([
      ...annotate,
      { $match: { slotDayIst: cohortSlotDayIso, status: { $in: TERMINAL_FAILURE } } },
      ...cohortSteps,
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
    return {
      data: {
        cohortSlotDayIso: range.isoDate,
        orphanSubmissionsMissingSlotDay: 0,
        duplicateRetryAttemptKeys: 0,
        sendsBeforeEligibility: 0,
        sendsAtOrAfterSlotStart: 0,
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
  return {
    data: {
      cohortSlotDayIso: range.isoDate,
      orphanSubmissionsMissingSlotDay: orphanSubmissionsMissingSlotDay?.c || 0,
      duplicateRetryAttemptKeys: duplicateRetryAttemptKeys?.c || 0,
      sendsBeforeEligibility: t.sendsBeforeEligibility || 0,
      sendsAtOrAfterSlotStart: t.sendsAtOrAfterSlotStart || 0,
      offsetsMsUsed: { pre4hr: pre4ms, meet: meetms, min30: min30ms }
    }
  };
}

module.exports = {
  ALLOWED_MESSAGE_KINDS,
  ALLOWED_SLOT_TIME_SUFFIXES,
  normalizeSlotTimeParam,
  computeRecipientDayOverview,
  computeRecipientMonthTrend,
  computeFailureReasonDistribution,
  computeTemplateReliabilityRanking,
  computeCohortDayDiagnostics,
  istDayRangeFromIso,
  annotateEventsWithSlotDayPipeline
};
