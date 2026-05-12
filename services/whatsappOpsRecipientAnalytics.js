/**
 * Deterministic recipient-based WhatsApp ops analytics (booking cohort: IST slot calendar day
 * + optional slot time, FormSubmission-backed). All-templates rollup groups by phone across message kinds.
 */
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const FormSubmission = require('../models/FormSubmission');

const ALLOWED_MESSAGE_KINDS = ['slot_booked', 'pre4hr', 'meet', '30min'];
const ALLOWED_SLOT_TIME_SUFFIXES = ['11AM', '3PM', '6PM', '7PM'];
const IST_OFFSET_MINUTES = 330;
const ACCEPTED_STATUSES = ['submitted', 'sent', 'delivered', 'read'];
const SENT_PLUS = ['sent', 'delivered', 'read'];
const DELIVERED_PLUS = ['delivered', 'read'];
const TERMINAL_FAILURE = ['failed', 'retry_exhausted'];
const IN_FLIGHT = ['queued', 'submitted', 'sent', 'retry_pending'];

function parseIsoDateOnly(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return null;
  return { y, m, d, iso: s };
}

function istDayRangeFromIso(dateIso) {
  const p = parseIsoDateOnly(dateIso);
  if (!p) return null;
  const startUtcMs = Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0, 0) - IST_OFFSET_MINUTES * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;
  return { from: new Date(startUtcMs), to: new Date(endUtcMs), isoDate: p.iso };
}

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

/** Annotate events with slotDayIst + lineageId + lookup slot from submission */
function annotateEventsWithSlotDayPipeline(messageKindFilter) {
  const match = {};
  if (messageKindFilter) match.messageKind = messageKindFilter;
  return [
    { $match: match },
    {
      $addFields: {
        lineageId: {
          $ifNull: ['$canonicalRetryGroupId', '$retryGroupId']
        }
      }
    },
    {
      $lookup: {
        from: 'formsubmissions',
        localField: 'formSubmissionId',
        foreignField: '_id',
        pipeline: [{ $project: { step3Data: 1, phone: 1 } }],
        as: 'subDoc'
      }
    },
    {
      $addFields: {
        slotDateFromSub: {
          $cond: [
            { $gt: [{ $size: '$subDoc' }, 0] },
            { $arrayElemAt: ['$subDoc.step3Data.slotDate', 0] },
            null
          ]
        },
        cohortFallback: {
          $cond: [
            {
              $and: [
                { $or: [{ $eq: ['$formSubmissionId', null] }, { $not: ['$formSubmissionId'] }] },
                { $lte: [{ $size: '$subDoc' }, 0] }
              ]
            },
            true,
            false
          ]
        }
      }
    },
    {
      $addFields: {
        slotDayIst: {
          $cond: [
            { $ne: ['$slotDateFromSub', null] },
            {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$slotDateFromSub',
                timezone: 'Asia/Kolkata'
              }
            },
            {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: 'Asia/Kolkata'
              }
            }
          ]
        }
      }
    }
  ];
}

/**
 * @returns {Promise<object>}
 */
async function computeRecipientDayOverview({ dateIso, messageKind = null, slotTime = 'all' }) {
  if (messageKind && !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
    return { error: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}` };
  }
  const slotTimeNorm = normalizeSlotTimeParam(slotTime);
  if (slotTimeNorm === null) {
    return { error: `Invalid slotTime. Allowed: all, ${ALLOWED_SLOT_TIME_SUFFIXES.join(', ')}` };
  }
  const range = istDayRangeFromIso(dateIso);
  if (!range) return { error: 'Invalid date format. Use YYYY-MM-DD' };

  const cohortFilter = buildBookingCohortFilter(range, slotTimeNorm);
  const [cohortBookedCount, cohortIds] = await Promise.all([
    FormSubmission.countDocuments(cohortFilter),
    FormSubmission.distinct('_id', cohortFilter)
  ]);

  const withWaIds =
    cohortIds.length > 0
      ? await WhatsAppMessageEvent.distinct('formSubmissionId', { formSubmissionId: { $in: cohortIds } })
      : [];
  const withWaSet = new Set(withWaIds.map((id) => String(id)));
  const bookedWithoutAnyWaEvent = cohortIds.filter((id) => !withWaSet.has(String(id))).length;

  const slotDayMatch = { $match: { slotDayIst: range.isoDate } };
  const cohortMatch = { $match: { formSubmissionId: { $in: cohortIds } } };
  const annotate = annotateEventsWithSlotDayPipeline(messageKind);

  const recipientGroupId = messageKind
    ? { lineageId: '$lineageId', phone: '$phone', messageKind: '$messageKind' }
    : { phone: '$phone' };

  const baseAfterAnnotate = [...annotate, slotDayMatch, cohortMatch];

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
      filter: { date: range.isoDate, messageKind: messageKind || null, slotTime: slotTimeNorm },
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

async function computeRecipientMonthTrend({ monthIso, messageKind = null }) {
  const s = String(monthIso || '').trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return { error: 'Invalid month YYYY-MM' };
  const [y, m] = s.split('-').map((x) => parseInt(x, 10));
  const pad = (n) => String(n).padStart(2, '0');
  const lastD = new Date(y, m, 0).getDate();
  const dayMin = `${y}-${pad(m)}-01`;
  const dayMax = `${y}-${pad(m)}-${pad(lastD)}`;

  const annotate = annotateEventsWithSlotDayPipeline(messageKind);
  const monthSlotMatch = { $match: { slotDayIst: { $gte: dayMin, $lte: dayMax } } };

  const simplified = await WhatsAppMessageEvent.aggregate([
    ...annotate,
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

async function computeFailureReasonDistribution({ from, to, messageKind = null, formSubmissionIds = null }) {
  const match = {
    status: { $in: TERMINAL_FAILURE },
    ...(from || to
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

async function computeTemplateReliabilityRanking({ from, to, formSubmissionIds = null }) {
  const match = {
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { $gte: from } : {}),
            ...(to ? { $lte: to } : {})
          }
        }
      : {}),
    ...(formSubmissionIds && formSubmissionIds.length
      ? { formSubmissionId: { $in: formSubmissionIds } }
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

module.exports = {
  ALLOWED_MESSAGE_KINDS,
  ALLOWED_SLOT_TIME_SUFFIXES,
  normalizeSlotTimeParam,
  computeRecipientDayOverview,
  computeRecipientMonthTrend,
  computeFailureReasonDistribution,
  computeTemplateReliabilityRanking,
  istDayRangeFromIso,
  annotateEventsWithSlotDayPipeline
};
