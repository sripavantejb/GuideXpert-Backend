/**
 * Pure aggregation helpers for WhatsApp ops charts/summary.
 * Extracted from controllers/whatsappOpsAdminController.js with no math changes.
 * These functions return chart-ready JSON so callers can either respond directly
 * (legacy live endpoints) or persist into WhatsAppOpsChartSnapshot for stable charts.
 */
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { WHATSAPP_MESSAGE_KINDS: ALLOWED_MESSAGE_KINDS } = WhatsAppMessageEvent;
const MessagingCronRun = require('../models/MessagingCronRun');
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
const FormSubmission = require('../models/FormSubmission');
const WhatsAppManualRecoveryJob = require('../models/WhatsAppManualRecoveryJob');
const cohortAgg = require('./whatsappOpsCohortShared');
const {
  TERMINAL_FAILURE_STATUSES,
  DLR_DELIVERED_STATUSES,
  IN_FLIGHT_PROMOTION_STATUSES
} = require('../utils/whatsappRetryRules');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const {
  parseOpsProductQuery,
  matchWhatsAppEventsByOpsProduct,
  effectiveOverviewMessageKind
} = require('../utils/whatsappOpsProduct');
const recipientAnalytics = require('./whatsappOpsRecipientAnalytics');
const canonical = require('./whatsappOpsCanonicalMetrics');
const { validateRecipientAnalyticsInvariants } = require('../utils/waAnalyticsIntegrity');

const IST_OFFSET_MINUTES = 330;
const IN_FLIGHT_STATUSES = IN_FLIGHT_PROMOTION_STATUSES;
const ACCEPTED_PLUS_STATUSES = ['submitted', 'sent', 'delivered', 'read'];

function parseIsoDateOnly(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return null;
  return { y, m, d, iso: s };
}

function parseIsoMonth(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const [y, m] = s.split('-').map((x) => parseInt(x, 10));
  if (!y || !m) return null;
  return { y, m, iso: s };
}

function istDayRangeFromIso(dateIso) {
  const p = parseIsoDateOnly(dateIso);
  if (!p) return null;
  const startUtcMs = Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0, 0) - (IST_OFFSET_MINUTES * 60 * 1000);
  const endUtcMs = startUtcMs + (24 * 60 * 60 * 1000) - 1;
  return { from: new Date(startUtcMs), to: new Date(endUtcMs), isoDate: p.iso };
}

function parseBoundaryDate(raw, mode) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const r = istDayRangeFromIso(value);
    if (!r) return null;
    return mode === 'start' ? r.from : r.to;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateRangeFromQuery(query = {}) {
  const from = parseBoundaryDate(query.from, 'start');
  const to = parseBoundaryDate(query.to, 'end') || new Date();
  return { from, to };
}

function istMonthRangeFromIso(monthIso) {
  const p = parseIsoMonth(monthIso);
  if (!p) return null;
  const startUtcMs = Date.UTC(p.y, p.m - 1, 1, 0, 0, 0, 0) - (IST_OFFSET_MINUTES * 60 * 1000);
  const nextMonthStartUtcMs = Date.UTC(p.m === 12 ? p.y + 1 : p.y, p.m === 12 ? 0 : p.m, 1, 0, 0, 0, 0)
    - (IST_OFFSET_MINUTES * 60 * 1000);
  return {
    from: new Date(startUtcMs),
    to: new Date(nextMonthStartUtcMs - 1),
    isoMonth: p.iso
  };
}

const MESSAGE_EVENT_STATS_FACET = {
  total: [{ $count: 'c' }],
  byKind: [{ $group: { _id: '$messageKind', c: { $sum: 1 } } }],
  byStatus: [{ $group: { _id: '$status', c: { $sum: 1 } } }],
  submittedAccepted: [{
    $match: { status: { $in: ['submitted', 'sent', 'delivered', 'read'] } }
  }, { $count: 'c' }],
  strictSubmitted: [{ $match: { status: 'submitted' } }, { $count: 'c' }],
  sentCumulative: [{
    $match: { status: { $in: ['sent', 'delivered', 'read'] } }
  }, { $count: 'c' }],
  deliveredCumulative: [{
    $match: { status: { $in: ['delivered', 'read'] } }
  }, { $count: 'c' }],
  readStrict: [{ $match: { status: 'read' } }, { $count: 'c' }],
  failed: [{ $match: { status: { $in: ['failed', 'retry_exhausted'] } } }, { $count: 'c' }],
  retryExhausted: [{ $match: { status: 'retry_exhausted' } }, { $count: 'c' }],
  retried: [{ $match: { retryCountSnapshot: { $gt: 0 } } }, { $count: 'c' }],
  slotBookedAttempts: [{ $match: { messageKind: 'slot_booked' } }, { $count: 'c' }]
};

function facetStatsPipeline(match) {
  return [{ $match: match }, { $facet: MESSAGE_EVENT_STATS_FACET }];
}

function slotDayIstPrefixStages(dateIso, messageKind, opsProduct) {
  const range = istDayRangeFromIso(dateIso);
  if (!range) return null;
  return {
    range,
    stages: [
      ...cohortAgg.annotateEventsWithSlotDayPipeline(messageKind, {
        strictSlotDay: true,
        opsProduct
      }),
      { $match: { slotDayIst: range.isoDate } }
    ]
  };
}

function facetStatsToTotals(facet) {
  return {
    whatsappAttempts: facet.total?.[0]?.c || 0,
    providerAcceptedCount: facet.submittedAccepted?.[0]?.c || 0,
    strictSubmittedCount: facet.strictSubmitted?.[0]?.c || 0,
    sentCount: facet.sentCumulative?.[0]?.c || 0,
    whatsappFailed: facet.failed?.[0]?.c || 0,
    deliveredCount: facet.deliveredCumulative?.[0]?.c || 0,
    readCount: facet.readStrict?.[0]?.c || 0,
    retried: facet.retried?.[0]?.c || 0,
    retryExhausted: facet.retryExhausted?.[0]?.c || 0,
    slotBookedAttempts: facet.slotBookedAttempts?.[0]?.c || 0
  };
}

/**
 * Identical aggregation as legacy controller.computeRetry2Exclusions; exported for snapshots.
 */
async function computeRetry2Exclusions(match, byAttempt) {
  const failedAtRetry1 = Number((byAttempt?.[2] || byAttempt?.['2'] || {}).failed || 0);
  const targetedAtRetry2 = Number((byAttempt?.[3] || byAttempt?.['3'] || {}).targeted || 0);
  const expectedGap = Math.max(0, failedAtRetry1 - targetedAtRetry2);
  const rows = await WhatsAppMessageEvent.aggregate([
    {
      $match: {
        ...match,
        attemptNumber: 2,
        retryExclusionReason: { $ne: null }
      }
    },
    { $group: { _id: '$retryExclusionReason', count: { $sum: 1 } } }
  ]);
  const byReason = {};
  rows.forEach((r) => {
    byReason[r._id] = r.count || 0;
  });
  const trackedExcluded = Object.values(byReason).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const residualUnclassified = Math.max(0, expectedGap - trackedExcluded);
  if (residualUnclassified > 0) {
    byReason.unclassified = residualUnclassified;
  }
  return {
    retry1Failed: failedAtRetry1,
    retry2Targeted: targetedAtRetry2,
    totalExcluded: expectedGap,
    trackedExcluded,
    byReason
  };
}

async function computeRetry2ExclusionsForPrefix(prefixStages, messageKind, byAttempt) {
  const failedAtRetry1 = Number((byAttempt?.[2] || byAttempt?.['2'] || {}).failed || 0);
  const targetedAtRetry2 = Number((byAttempt?.[3] || byAttempt?.['3'] || {}).targeted || 0);
  const expectedGap = Math.max(0, failedAtRetry1 - targetedAtRetry2);
  const kindStages = messageKind ? [{ $match: { messageKind } }] : [];
  const rows = await WhatsAppMessageEvent.aggregate([
    ...prefixStages,
    ...kindStages,
    { $match: { attemptNumber: 2, retryExclusionReason: { $ne: null } } },
    { $group: { _id: '$retryExclusionReason', count: { $sum: 1 } } }
  ]);
  const byReason = {};
  rows.forEach((r) => {
    byReason[r._id] = r.count || 0;
  });
  const trackedExcluded = Object.values(byReason).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const residualUnclassified = Math.max(0, expectedGap - trackedExcluded);
  if (residualUnclassified > 0) {
    byReason.unclassified = residualUnclassified;
  }
  return {
    retry1Failed: failedAtRetry1,
    retry2Targeted: targetedAtRetry2,
    totalExcluded: expectedGap,
    trackedExcluded,
    byReason
  };
}

/**
 * @returns {Promise<{ data: object } | { error: string }>}
 */
async function computeSummary({ from, to, messageKind = null, opsProduct = null } = {}) {
  if (messageKind && !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
    return { error: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}` };
  }
  const match = {};
  if (from || to) {
    match.createdAt = {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {})
    };
  }
  if (messageKind) match.messageKind = messageKind;
  Object.assign(match, matchWhatsAppEventsByOpsProduct(parseOpsProductQuery(opsProduct)));

  const [msgAgg] = await WhatsAppMessageEvent.aggregate([
    { $match: match },
    {
      $facet: {
        total: [{ $count: 'c' }],
        byKind: [{ $group: { _id: '$messageKind', c: { $sum: 1 } } }],
        byStatus: [{ $group: { _id: '$status', c: { $sum: 1 } } }],
        successes: [{
          $match: { status: { $in: ['submitted', 'sent', 'delivered', 'read'] } }
        }, { $count: 'c' }],
        submittedAccepted: [{
          $match: { status: { $in: ['submitted', 'sent', 'delivered', 'read'] } }
        }, { $count: 'c' }],
        sentCumulative: [{
          $match: { status: { $in: ['sent', 'delivered', 'read'] } }
        }, { $count: 'c' }],
        failed: [{ $match: { status: { $in: ['failed', 'retry_exhausted'] } } }, { $count: 'c' }],
        delivered: [{ $match: { status: { $in: ['delivered', 'read'] } } }, { $count: 'c' }],
        read: [{ $match: { status: 'read' } }, { $count: 'c' }],
        retryExhausted: [{ $match: { status: 'retry_exhausted' } }, { $count: 'c' }],
        retried: [{ $match: { retryCountSnapshot: { $gt: 0 } } }, { $count: 'c' }]
      }
    }
  ]);

  const total = msgAgg.total[0]?.c || 0;
  const successN = msgAgg.successes[0]?.c || 0;
  const acceptedN = msgAgg.submittedAccepted[0]?.c || 0;
  const failedN = msgAgg.failed[0]?.c || 0;
  const deliveredN = msgAgg.delivered[0]?.c || 0;
  const readN = msgAgg.read[0]?.c || 0;
  const sentN = msgAgg.sentCumulative[0]?.c || 0;
  const retryExN = msgAgg.retryExhausted[0]?.c || 0;
  const retriedN = msgAgg.retried[0]?.c || 0;

  let c = null;
  let webhookN = null;
  if (!messageKind) {
    const cronMatch = from || to
      ? {
          startedAt: {
            ...(from ? { $gte: from } : {}),
            ...(to ? { $lte: to } : {})
          }
        }
      : {};
    const cronCounts = await MessagingCronRun.aggregate([
      { $match: cronMatch },
      {
        $group: {
          _id: null,
          runs: { $sum: 1 },
          ok: { $sum: { $cond: ['$success', 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$success', false] }, 1, 0] } }
        }
      }
    ]);
    c = cronCounts[0] || { runs: 0, ok: 0, failed: 0 };
    webhookN = await WhatsAppWebhookEvent.countDocuments(from || to
      ? {
          receivedAt: {
            ...(from ? { $gte: from } : {}),
            ...(to ? { $lte: to } : {})
          }
        }
      : {});
  }

  const recipientRange = await recipientAnalytics.computeRecipientRangeSummary({
    from,
    to,
    messageKind,
    opsProduct
  });

  const recipientPrimary = recipientRange.error ? null : recipientRange.data;
  const integrity = recipientPrimary
    ? validateRecipientAnalyticsInvariants({
        recipientTotals: recipientPrimary.recipientTotals,
        outcomeBreakdown: null
      })
    : { ok: true, violations: [] };

  return {
    data: {
      ...canonical.buildAnalyticsMeta(),
      meta: {
        selectedMessageKind: messageKind || null,
        opsProduct: parseOpsProductQuery(opsProduct),
        primaryCohortMode: canonical.COHORT_ANCHOR,
        rangeNote: recipientPrimary?.rangeNote || null
      },
      recipientTotals: recipientPrimary?.recipientTotals || null,
      recipientTrendDays: recipientPrimary?.days || [],
      integrityWarnings: integrity.violations,
      diagnostic: {
        eventTimeSummary: {
          cohortMode: 'event_time_utc',
          cohortNote: 'Diagnostic only — filters by message createdAt, not IST slot-day booking cohort.',
          attemptedRows: total,
          totals: {
            whatsappAttempts: total,
            whatsappSuccessApprox: successN,
            providerAcceptedCount: acceptedN,
            sentCount: sentN,
            whatsappFailed: failedN,
            deliveredCount: deliveredN,
            readCount: readN,
            retried: retriedN,
            permanentlyFailedApprox: retryExN,
            ...(messageKind ? {} : { webhookEvents: webhookN })
          },
          rates: {
            deliveryRatePct: total ? Math.round((successN / total) * 1000) / 10 : null,
            retryRatePct: total ? Math.round((retriedN / total) * 1000) / 10 : null
          },
          byKind: (msgAgg.byKind || []).map((x) => ({ kind: x._id, count: x.c })),
          byStatus: (msgAgg.byStatus || []).map((x) => ({ status: x._id, count: x.c }))
        },
        ...(messageKind
          ? {}
          : {
              cronRuns: {
                runs: c?.runs || 0,
                success: c?.ok || 0,
                failure: c?.failed || 0
              }
            })
      },
      /** @deprecated Use recipientTotals */
      totals: recipientPrimary?.recipientTotals
        ? {
            whatsappAttempts: recipientPrimary.recipientTotals.totalRecipients,
            deliveredCount: recipientPrimary.recipientTotals.delivered,
            whatsappFailed: recipientPrimary.recipientTotals.finalPermanentFailed,
            readCount: recipientPrimary.recipientTotals.read
          }
        : {
            whatsappAttempts: total,
            deliveredCount: deliveredN,
            whatsappFailed: failedN,
            readCount: readN
          },
      filter: { messageKind: messageKind || null, opsProduct: parseOpsProductQuery(opsProduct) },
      range: from ? { from, to } : { from: null, to }
    }
  };
}

async function computeMonthOverview({ monthIso, messageKind = null, opsProduct = null }) {
  if (messageKind && !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
    return { error: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}` };
  }
  const range = istMonthRangeFromIso(monthIso);
  if (!range) return { error: 'Invalid month format. Use YYYY-MM' };

  const opsSlug = parseOpsProductQuery(opsProduct);
  const effKind = effectiveOverviewMessageKind(opsProduct, messageKind);

  const bookingMatchGx = {
    'step3Data.slotDate': { $gte: range.from, $lte: range.to }
  };

  const pad = (n) => String(n).padStart(2, '0');
  const p = parseIsoMonth(monthIso);
  if (!p) return { error: 'Invalid month format. Use YYYY-MM' };
  const lastD = new Date(p.y, p.m, 0).getDate();
  const dayMin = `${p.y}-${pad(p.m)}-01`;
  const dayMax = `${p.y}-${pad(p.m)}-${pad(lastD)}`;

  const monthAnnotate = cohortAgg.annotateEventsWithSlotDayPipeline(effKind, {
    strictSlotDay: true,
    opsProduct
  });

  const [eventsByDay, bookingsByDay] = await Promise.all([
    WhatsAppMessageEvent.aggregate([
      ...monthAnnotate,
      { $match: { slotDayIst: { $gte: dayMin, $lte: dayMax, $ne: null } } },
      {
        $group: {
          _id: {
            day: '$slotDayIst'
          },
          attempts: { $sum: 1 },
          failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'retry_exhausted']] }, 1, 0] } },
          delivered: {
            $sum: { $cond: [{ $in: ['$status', ['delivered', 'read']] }, 1, 0] }
          },
          read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
          accepted: {
            $sum: { $cond: [{ $in: ['$status', ['submitted', 'sent', 'delivered', 'read']] }, 1, 0] }
          },
          sent: {
            $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read']] }, 1, 0] }
          },
          retried: { $sum: { $cond: [{ $gt: ['$retryCountSnapshot', 0] }, 1, 0] } }
        }
      }
    ]),
    opsSlug === 'iit_counselling'
      ? IitCounsellingSubmission.aggregate([
        { $match: { counsellingSlotInstantUtc: { $gte: range.from, $lte: range.to } } },
        {
          $group: {
            _id: {
              day: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$counsellingSlotInstantUtc',
                  timezone: 'Asia/Kolkata'
                }
              }
            },
            bookedSlotsCount: { $sum: 1 }
          }
        }
      ])
      : FormSubmission.aggregate([
        { $match: bookingMatchGx },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$step3Data.slotDate', timezone: 'Asia/Kolkata' } }
            },
            bookedSlotsCount: { $sum: 1 }
          }
        }
      ])
  ]);

  const byDayMap = new Map();
  eventsByDay.forEach((r) => {
    byDayMap.set(r._id.day, {
      date: r._id.day,
      attempts: r.attempts || 0,
      accepted: r.accepted || 0,
      sent: r.sent || 0,
      delivered: r.delivered || 0,
      read: r.read || 0,
      failed: r.failed || 0,
      retried: r.retried || 0,
      bookedSlotsCount: 0
    });
  });
  bookingsByDay.forEach((r) => {
    const day = r._id.day;
    const prev = byDayMap.get(day) || {
      date: day,
      attempts: 0,
      accepted: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      retried: 0,
      bookedSlotsCount: 0
    };
    prev.bookedSlotsCount = r.bookedSlotsCount || 0;
    byDayMap.set(day, prev);
  });

  const days = [...byDayMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const monthTotals = days.reduce((acc, d) => ({
    bookedSlotsCount: acc.bookedSlotsCount + (d.bookedSlotsCount || 0),
    attempts: acc.attempts + (d.attempts || 0),
    accepted: acc.accepted + (d.accepted || 0),
    sent: acc.sent + (d.sent || 0),
    delivered: acc.delivered + (d.delivered || 0),
    read: acc.read + (d.read || 0),
    failed: acc.failed + (d.failed || 0),
    retried: acc.retried + (d.retried || 0)
  }), {
    bookedSlotsCount: 0,
    attempts: 0,
    accepted: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    retried: 0
  });

  return {
    data: {
      cohortAnchor: 'booking_ist_slot_day',
      filter: { month: range.isoMonth, messageKind: messageKind || null, opsProduct: opsSlug },
      range: { from: range.from, to: range.to },
      monthTotals,
      days
    }
  };
}

async function computeDayOverview({ dateIso, messageKind = null, opsProduct = null } = {}) {
  if (messageKind && !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
    return { error: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}` };
  }
  const opsSlug = parseOpsProductQuery(opsProduct);
  const effKind = effectiveOverviewMessageKind(opsProduct, messageKind);
  const prefix = slotDayIstPrefixStages(dateIso, effKind, opsProduct);
  if (!prefix) return { error: 'Invalid date format. Use YYYY-MM-DD' };
  const { range, stages: prefixStages } = prefix;

  const kindMatchStages = effKind ? [{ $match: { messageKind: effKind } }] : [];

  const attemptFacet = [
    ...prefixStages,
    ...kindMatchStages,
    {
      $group: {
        _id: '$attemptNumber',
        targeted: { $sum: 1 },
        submittedPlus: {
          $sum: { $cond: [{ $in: ['$status', ['submitted', 'sent', 'delivered', 'read']] }, 1, 0] }
        },
        sentPlus: {
          $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read']] }, 1, 0] }
        },
        deliveredPlus: {
          $sum: { $cond: [{ $in: ['$status', ['delivered', 'read']] }, 1, 0] }
        },
        readStrict: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
        failed: {
          $sum: { $cond: [{ $in: ['$status', ['failed', 'retry_exhausted']] }, 1, 0] }
        },
        inFlight: {
          $sum: {
            $cond: [{ $in: ['$status', ['queued', 'submitted', 'retry_pending', 'sent']] }, 1, 0]
          }
        }
      }
    }
  ];

  const [bookedSlotsCount, allFacet, filteredFacet, filteredByAttempt, uniqDelivered] = await Promise.all([
    opsSlug === 'iit_counselling'
      ? IitCounsellingSubmission.countDocuments({
        counsellingSlotInstantUtc: { $gte: range.from, $lte: range.to }
      })
      : FormSubmission.countDocuments({ 'step3Data.slotDate': { $gte: range.from, $lte: range.to } }),
    WhatsAppMessageEvent.aggregate([...prefixStages, { $facet: MESSAGE_EVENT_STATS_FACET }]),
    WhatsAppMessageEvent.aggregate([
      ...prefixStages,
      ...kindMatchStages,
      { $facet: MESSAGE_EVENT_STATS_FACET }
    ]),
    WhatsAppMessageEvent.aggregate(attemptFacet),
    WhatsAppMessageEvent.aggregate([
      ...prefixStages,
      ...kindMatchStages,
      { $match: { status: { $in: ['delivered', 'read'] } } },
      { $group: { _id: '$phone' } },
      { $count: 'c' }
    ])
  ]);

  const allStats = allFacet[0] || {};
  const filteredStats = filteredFacet[0] || {};
  const overall = facetStatsToTotals(allStats);
  const filtered = facetStatsToTotals(filteredStats);
  const byKind = (allStats.byKind || []).map((x) => ({ kind: x._id, count: x.c }));
  const byStatus = (allStats.byStatus || []).map((x) => ({ status: x._id, count: x.c }));
  const byAttempt = {};
  (filteredByAttempt || []).forEach((row) => {
    const key = row._id;
    byAttempt[key] = {
      targeted: row.targeted || 0,
      submitted: row.submittedPlus || 0,
      sent: row.sentPlus || 0,
      delivered: row.deliveredPlus || 0,
      read: row.readStrict || 0,
      failed: row.failed || 0,
      inFlight: row.inFlight || 0
    };
  });
  const retry2Exclusions = effKind
    ? await computeRetry2ExclusionsForPrefix(prefixStages, effKind, byAttempt)
    : { retry1Failed: 0, retry2Targeted: 0, totalExcluded: 0, trackedExcluded: 0, byReason: {} };

  return {
    data: {
      cohortAnchor: 'booking_ist_slot_day',
      filter: { date: range.isoDate, messageKind: messageKind || null, opsProduct: opsSlug },
      range: { from: range.from, to: range.to },
      bookedSlotsCount,
      overall,
      selectedKindMetrics: filtered,
      byKind,
      byStatus,
      byAttempt,
      retry2Exclusions,
      uniqueRecipientsDeliveredRead: uniqDelivered[0]?.c || 0
    }
  };
}

/**
 * Deterministic key used to upsert/replace WhatsAppOpsChartSnapshot per scope.
 * @param {{ scope: 'summary'|'month'|'day', messageKind?: string|null, monthIso?: string|null, dateIso?: string|null, fromIso?: string|null, toIso?: string|null, slotTime?: string|null, opsProduct?: string|null }} parts
 */
function buildScopeKey(parts) {
  const scope = String(parts.scope || '').toLowerCase();
  const kind = parts.messageKind || 'all';
  const prod = parseOpsProductQuery(parts.opsProduct);
  const prodSeg = prod === 'iit_counselling' ? 'iitc' : 'gx';
  if (scope === 'month') return `month:${prodSeg}:${kind}:${parts.monthIso || ''}`;
  if (scope === 'day') {
    const date = parts.dateIso || '';
    const st = parts.slotTime && String(parts.slotTime) !== 'all' ? String(parts.slotTime) : '';
    return st ? `day:${prodSeg}:${kind}:${date}:${st}` : `day:${prodSeg}:${kind}:${date}`;
  }
  return `summary:${prodSeg}:${kind}:${parts.fromIso || ''}:${parts.toIso || ''}`;
}

/* ============================================================================
 * Operational Health (closed historical window + today live strip)
 * ========================================================================= */

function clampWindowDays(value) {
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n)) return 14;
  return Math.min(Math.max(n, 1), 60);
}

function buildClosedWindow(asOfDateIso, windowDays) {
  const today = istDayRangeFromIso(asOfDateIso);
  if (!today) return null;
  const days = clampWindowDays(windowDays);
  /** Stable window ends one ms before today's IST 00:00 (yesterday inclusive). */
  const stableTo = new Date(today.from.getTime() - 1);
  /** Stable window starts windowDays before today's IST 00:00. */
  const stableFrom = new Date(today.from.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    today: { from: today.from, to: today.to, isoDate: today.isoDate },
    stable: { from: stableFrom, to: stableTo, days }
  };
}

function divPct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

/** Widen createdAt then restrict to IST slot-day window for slot-cohort KPIs */
function slotCohortPipelinePrefixFromStableWindow(stableFrom, stableTo, messageKind, opsProduct = null) {
  const bufferFrom = new Date(stableFrom.getTime() - 8 * 24 * 60 * 60 * 1000);
  const bufferTo = new Date(stableTo.getTime() + 2 * 24 * 60 * 60 * 1000);
  const dayMin = stableFrom.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const dayMax = stableTo.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const kindStages = messageKind ? [{ $match: { messageKind } }] : [];
  return [
    { $match: { createdAt: { $gte: bufferFrom, $lte: bufferTo } } },
    ...kindStages,
    ...cohortAgg.annotateEventsWithSlotDayPipeline(messageKind, { strictSlotDay: true, opsProduct }),
    { $match: { slotDayIst: { $gte: dayMin, $lte: dayMax, $ne: null } } }
  ];
}

async function computeStableFunnel(match) {
  const [agg] = await WhatsAppMessageEvent.aggregate([
    { $match: match },
    {
      $facet: {
        targeted: [{ $count: 'c' }],
        accepted: [{ $match: { status: { $in: ACCEPTED_PLUS_STATUSES } } }, { $count: 'c' }],
        sent: [{ $match: { status: { $in: ['sent', 'delivered', 'read'] } } }, { $count: 'c' }],
        delivered: [{ $match: { status: { $in: DLR_DELIVERED_STATUSES } } }, { $count: 'c' }],
        read: [{ $match: { status: 'read' } }, { $count: 'c' }]
      }
    }
  ]);
  const targeted = agg?.targeted?.[0]?.c || 0;
  const accepted = agg?.accepted?.[0]?.c || 0;
  const sent = agg?.sent?.[0]?.c || 0;
  const delivered = agg?.delivered?.[0]?.c || 0;
  const read = agg?.read?.[0]?.c || 0;
  return {
    stages: [
      { id: 'targeted', label: 'Targeted', count: targeted, dropFromPrevPct: null },
      { id: 'accepted', label: 'Accepted (Gupshup)', count: accepted, dropFromPrevPct: divPct(targeted - accepted, targeted) },
      { id: 'sent', label: 'Sent (DLR)', count: sent, dropFromPrevPct: divPct(accepted - sent, accepted) },
      { id: 'delivered', label: 'Delivered', count: delivered, dropFromPrevPct: divPct(sent - delivered, sent) },
      { id: 'read', label: 'Read', count: read, dropFromPrevPct: divPct(delivered - read, delivered) }
    ],
    deliveryRatePct: divPct(delivered, targeted),
    acceptedToDeliveredPct: divPct(delivered, accepted),
    deliveredToReadPct: divPct(read, delivered)
  };
}

/**
 * Per-template reliability: targeted, delivered, failed, exhausted, deliveryRatePct, retryEffectivenessPct.
 *
 * `retryEffectivenessPct` measures how many groups whose attempt 1 was a terminal failure
 * (`failed` or `retry_exhausted`) ultimately reached `delivered/read` via a later attempt
 * sharing the same `retryGroupId`. Computed per-template with `$lookup` so this number
 * stays meaningful even when retries spill across day boundaries.
 */
async function computeTemplateReliability(stableFrom, stableTo) {
  const prefix = slotCohortPipelinePrefixFromStableWindow(stableFrom, stableTo, null);

  const totalsRows = await WhatsAppMessageEvent.aggregate([
    ...prefix,
    {
      $group: {
        _id: '$messageKind',
        targeted: { $sum: 1 },
        accepted: { $sum: { $cond: [{ $in: ['$status', ACCEPTED_PLUS_STATUSES] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $in: ['$status', DLR_DELIVERED_STATUSES] }, 1, 0] } },
        read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $in: ['$status', TERMINAL_FAILURE_STATUSES] }, 1, 0] } },
        exhausted: { $sum: { $cond: [{ $eq: ['$status', 'retry_exhausted'] }, 1, 0] } },
        excluded: { $sum: { $cond: [{ $ne: ['$retryExclusionReason', null] }, 1, 0] } }
      }
    }
  ]);
  const rowMap = new Map(totalsRows.map((r) => [r._id || 'unknown', r]));

  /** Recovery effectiveness: groups whose attempt 1 was terminal-failed but later attempt delivered. */
  const recoveryRows = await WhatsAppMessageEvent.aggregate([
    ...prefix,
    {
      $match: {
        attemptNumber: 1,
        status: { $in: TERMINAL_FAILURE_STATUSES },
        retryGroupId: { $ne: null }
      }
    },
    {
      $lookup: {
        from: 'whatsappmessageevents',
        let: { gid: '$retryGroupId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$retryGroupId', '$$gid'] },
                  { $gt: ['$attemptNumber', 1] },
                  { $in: ['$status', DLR_DELIVERED_STATUSES] }
                ]
              }
            }
          },
          { $limit: 1 }
        ],
        as: 'recovered'
      }
    },
    {
      $group: {
        _id: '$messageKind',
        attempt1Failures: { $sum: 1 },
        recovered: { $sum: { $cond: [{ $gt: [{ $size: '$recovered' }, 0] }, 1, 0] } }
      }
    }
  ]);
  const recoveryMap = new Map(recoveryRows.map((r) => [r._id || 'unknown', r]));

  const unresolvedRows = await WhatsAppMessageEvent.aggregate([
    ...prefix,
    {
      $group: {
        _id: { kind: '$messageKind', phone: '$phone' },
        anyDelivered: {
          $max: { $cond: [{ $in: ['$status', DLR_DELIVERED_STATUSES] }, 1, 0] }
        },
        anyTerminalFail: {
          $max: { $cond: [{ $in: ['$status', TERMINAL_FAILURE_STATUSES] }, 1, 0] }
        }
      }
    },
    {
      $group: {
        _id: '$_id.kind',
        unresolved: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$anyTerminalFail', 1] }, { $eq: ['$anyDelivered', 0] }] },
              1,
              0
            ]
          }
        },
        distinctRecipients: { $sum: 1 }
      }
    }
  ]);
  const unresolvedMap = new Map(unresolvedRows.map((r) => [r._id || 'unknown', r]));

  return ALLOWED_MESSAGE_KINDS.map((kind) => {
    const row = rowMap.get(kind) || {};
    const targeted = row.targeted || 0;
    const delivered = row.delivered || 0;
    const failed = row.failed || 0;
    const exhausted = row.exhausted || 0;
    const accepted = row.accepted || 0;
    const read = row.read || 0;
    const excluded = row.excluded || 0;
    const rec = recoveryMap.get(kind) || { attempt1Failures: 0, recovered: 0 };
    const ures = unresolvedMap.get(kind) || { unresolved: 0, distinctRecipients: 0 };
    return {
      kind,
      targeted,
      accepted,
      delivered,
      read,
      failed,
      exhausted,
      excluded,
      deliveryRatePct: divPct(delivered, targeted),
      acceptedToDeliveredPct: divPct(delivered, accepted),
      retryEffectivenessPct: divPct(rec.recovered, rec.attempt1Failures),
      attempt1Failures: rec.attempt1Failures,
      recoveredFromAttempt1: rec.recovered,
      unresolvedRecipients: ures.unresolved,
      distinctRecipients: ures.distinctRecipients
    };
  });
}

async function computeDailyTrend(stableFrom, stableTo, messageKind) {
  const prefix = slotCohortPipelinePrefixFromStableWindow(stableFrom, stableTo, messageKind);
  const rows = await WhatsAppMessageEvent.aggregate([
    ...prefix,
    {
      $group: {
        _id: { day: '$slotDayIst' },
        attempts: { $sum: 1 },
        accepted: { $sum: { $cond: [{ $in: ['$status', ACCEPTED_PLUS_STATUSES] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $in: ['$status', DLR_DELIVERED_STATUSES] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $in: ['$status', TERMINAL_FAILURE_STATUSES] }, 1, 0] } },
        retry_exhausted: { $sum: { $cond: [{ $eq: ['$status', 'retry_exhausted'] }, 1, 0] } },
        retried: { $sum: { $cond: [{ $gt: ['$attemptNumber', 1] }, 1, 0] } }
      }
    },
    { $sort: { '_id.day': 1 } }
  ]);
  return rows.map((r) => ({
    date: r._id.day,
    attempts: r.attempts || 0,
    accepted: r.accepted || 0,
    delivered: r.delivered || 0,
    failed: r.failed || 0,
    retryExhausted: r.retry_exhausted || 0,
    retried: r.retried || 0
  }));
}

/** Event-time (createdAt) trend for incident debugging — not slot-cohort */
async function computeDailyTrendEventTime(stableFrom, stableTo, messageKind) {
  const match = {
    createdAt: { $gte: stableFrom, $lte: stableTo },
    ...(messageKind ? { messageKind } : {})
  };
  const rows = await WhatsAppMessageEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } } },
        attempts: { $sum: 1 },
        accepted: { $sum: { $cond: [{ $in: ['$status', ACCEPTED_PLUS_STATUSES] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $in: ['$status', DLR_DELIVERED_STATUSES] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $in: ['$status', TERMINAL_FAILURE_STATUSES] }, 1, 0] } },
        retry_exhausted: { $sum: { $cond: [{ $eq: ['$status', 'retry_exhausted'] }, 1, 0] } },
        retried: { $sum: { $cond: [{ $gt: ['$attemptNumber', 1] }, 1, 0] } }
      }
    },
    { $sort: { '_id.day': 1 } }
  ]);
  return rows.map((r) => ({
    date: r._id.day,
    attempts: r.attempts || 0,
    accepted: r.accepted || 0,
    delivered: r.delivered || 0,
    failed: r.failed || 0,
    retryExhausted: r.retry_exhausted || 0,
    retried: r.retried || 0
  }));
}

async function computeTopFailureReasons(stableFrom, stableTo, messageKind) {
  const match = {
    createdAt: { $gte: stableFrom, $lte: stableTo },
    errorMessage: { $nin: [null, ''] },
    ...(messageKind ? { messageKind } : {})
  };
  const rows = await WhatsAppMessageEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $substrCP: ['$errorMessage', 0, 200] },
        count: { $sum: 1 },
        lastAt: { $max: '$createdAt' },
        kinds: { $addToSet: '$messageKind' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);
  return rows.map((r) => ({
    errorMessage: r._id,
    count: r.count || 0,
    lastAt: r.lastAt,
    kinds: r.kinds || []
  }));
}

async function computeRetryAttemptStable(stableFrom, stableTo, messageKind) {
  /** Now supports messageKind=null (aggregate across templates) so the Retry Funnel
   *  on the Health page never collapses when the user is in `All templates` mode. */
  const prefix = slotCohortPipelinePrefixFromStableWindow(stableFrom, stableTo, messageKind);
  const [rows, exclusionRows] = await Promise.all([
    WhatsAppMessageEvent.aggregate([
      ...prefix,
      {
        $group: {
          _id: '$attemptNumber',
          targeted: { $sum: 1 },
          submitted: { $sum: { $cond: [{ $in: ['$status', ACCEPTED_PLUS_STATUSES] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read']] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $in: ['$status', DLR_DELIVERED_STATUSES] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $in: ['$status', TERMINAL_FAILURE_STATUSES] }, 1, 0] } },
          excluded: { $sum: { $cond: [{ $ne: ['$retryExclusionReason', null] }, 1, 0] } },
          inFlight: { $sum: { $cond: [{ $in: ['$status', IN_FLIGHT_STATUSES] }, 1, 0] } }
        }
      }
    ]),
    WhatsAppMessageEvent.aggregate([
      ...prefix,
      { $match: { retryExclusionReason: { $ne: null } } },
      {
        $group: {
          _id: { attempt: '$attemptNumber', reason: '$retryExclusionReason' },
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  const exclusionMap = { 1: {}, 2: {}, 3: {} };
  exclusionRows.forEach((r) => {
    const att = r._id?.attempt;
    const reason = r._id?.reason;
    if (!att || !reason || !exclusionMap[att]) return;
    exclusionMap[att][reason] = (exclusionMap[att][reason] || 0) + (r.count || 0);
  });

  const byAttempt = { 1: null, 2: null, 3: null };
  rows.forEach((r) => {
    if (!Object.prototype.hasOwnProperty.call(byAttempt, r._id)) return;
    byAttempt[r._id] = {
      targeted: r.targeted || 0,
      submitted: r.submitted || 0,
      accepted: r.submitted || 0,
      sent: r.sent || 0,
      delivered: r.delivered || 0,
      read: r.read || 0,
      failed: r.failed || 0,
      excluded: r.excluded || 0,
      inFlight: r.inFlight || 0,
      deliveryRatePct: divPct(r.delivered || 0, r.targeted || 0),
      excludedByReason: exclusionMap[r._id] || {}
    };
  });
  return byAttempt;
}

async function computeTodayLiveStrip(todayRange, messageKind) {
  const prefix = slotCohortPipelinePrefixFromStableWindow(todayRange.from, todayRange.to, messageKind);
  const [bookings, agg] = await Promise.all([
    FormSubmission.countDocuments({ 'step3Data.slotDate': { $gte: todayRange.from, $lte: todayRange.to } }),
    WhatsAppMessageEvent.aggregate([
      ...prefix,
      {
        $facet: {
          attempts: [{ $count: 'c' }],
          accepted: [{ $match: { status: { $in: ACCEPTED_PLUS_STATUSES } } }, { $count: 'c' }],
          delivered: [{ $match: { status: { $in: DLR_DELIVERED_STATUSES } } }, { $count: 'c' }],
          failed: [{ $match: { status: { $in: TERMINAL_FAILURE_STATUSES } } }, { $count: 'c' }],
          retryExhausted: [{ $match: { status: 'retry_exhausted' } }, { $count: 'c' }],
          inFlight: [{ $match: { status: { $in: IN_FLIGHT_STATUSES } } }, { $count: 'c' }]
        }
      }
    ])
  ]);
  const f = agg?.[0] || {};
  return {
    isLive: true,
    isoDate: todayRange.isoDate,
    bookings,
    attempts: f.attempts?.[0]?.c || 0,
    accepted: f.accepted?.[0]?.c || 0,
    delivered: f.delivered?.[0]?.c || 0,
    failed: f.failed?.[0]?.c || 0,
    retryExhausted: f.retryExhausted?.[0]?.c || 0,
    inFlight: f.inFlight?.[0]?.c || 0
  };
}

/**
 * Cross-cutting unresolved across the stable window: distinct phones with at least one
 * terminal failure / exclusion / stale in-flight, and zero delivered/read. Computed
 * lazily here (small enough for stable window).
 */
async function computeUnresolvedHeader(stableFrom, stableTo) {
  const inFlightStaleBefore = new Date(Date.now() - 180 * 60 * 1000);
  const prefix = slotCohortPipelinePrefixFromStableWindow(stableFrom, stableTo, null);
  const rows = await WhatsAppMessageEvent.aggregate([
    ...prefix,
    {
      $group: {
        _id: { kind: '$messageKind', phone: '$phone' },
        terminalFail: { $max: { $cond: [{ $in: ['$status', TERMINAL_FAILURE_STATUSES] }, 1, 0] } },
        excluded: { $max: { $cond: [{ $ne: ['$retryExclusionReason', null] }, 1, 0] } },
        staleInFlight: {
          $max: {
            $cond: [
              {
                $and: [
                  { $in: ['$status', IN_FLIGHT_STATUSES] },
                  { $lte: ['$createdAt', inFlightStaleBefore] }
                ]
              },
              1,
              0
            ]
          }
        },
        anyDelivered: { $max: { $cond: [{ $in: ['$status', DLR_DELIVERED_STATUSES] }, 1, 0] } }
      }
    },
    {
      $group: {
        _id: null,
        unresolved: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$anyDelivered', 0] },
                  {
                    $or: [
                      { $eq: ['$terminalFail', 1] },
                      { $eq: ['$excluded', 1] },
                      { $eq: ['$staleInFlight', 1] }
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
    }
  ]);
  return rows[0]?.unresolved || 0;
}

async function computeOperationalHealth({ asOfDateIso, windowDays = 14, messageKind = null } = {}) {
  if (messageKind && !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
    return { error: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}` };
  }
  const dateIso = asOfDateIso || new Date().toISOString().slice(0, 10);
  const win = buildClosedWindow(dateIso, windowDays);
  if (!win) return { error: 'Invalid date format. Use YYYY-MM-DD' };

  const stableMatch = {
    createdAt: { $gte: win.stable.from, $lte: win.stable.to },
    ...(messageKind ? { messageKind } : {})
  };

  const [
    funnelStable,
    templateReliabilityStable,
    dailyTrendStable,
    dailyTrendEventTime,
    topFailureReasonsStable,
    retryAttemptStable,
    todayLiveStrip,
    activeRecoveryJobs,
    unresolvedHeader
  ] = await Promise.all([
    computeStableFunnel(stableMatch),
    computeTemplateReliability(win.stable.from, win.stable.to),
    computeDailyTrend(win.stable.from, win.stable.to, messageKind),
    computeDailyTrendEventTime(win.stable.from, win.stable.to, messageKind),
    computeTopFailureReasons(win.stable.from, win.stable.to, messageKind),
    computeRetryAttemptStable(win.stable.from, win.stable.to, messageKind),
    computeTodayLiveStrip(win.today, messageKind),
    WhatsAppManualRecoveryJob.countDocuments({ status: { $in: ['queued', 'running'] } }),
    computeUnresolvedHeader(win.stable.from, win.stable.to)
  ]);

  const { getCronScheduleHealth } = require('../utils/waCronScheduleHealth');
  const { getReconciliationObservability } = require('../utils/waReconcileObservability');
  const { getReminderJobObservability } = require('../utils/waReminderJobObservability');
  const [cronScheduleHealth, reconciliationHealth, recipientRange, reminderJobHealth] =
    await Promise.all([
      getCronScheduleHealth(),
      getReconciliationObservability(),
      recipientAnalytics.computeRecipientRangeSummary({
        from: win.stable.from,
        to: win.stable.to,
        messageKind
      }),
      getReminderJobObservability(
        messageKind ? { messageKind } : {}
      )
    ]);

  const recipientTotals = recipientRange.error ? null : recipientRange.data?.recipientTotals;
  const analyticsIntegrity = recipientTotals
    ? validateRecipientAnalyticsInvariants({ recipientTotals })
    : { ok: true, violations: [] };

  return {
    data: {
      cronScheduleHealth,
      reconciliationHealth,
      reminderJobHealth,
      analyticsIntegrity,
      recipientPrimarySummary: recipientRange.error ? null : recipientRange.data,
      metricDefinitions: canonical.METRIC_DEFINITIONS,
      filter: { asOfDateIso: dateIso, windowDays: win.stable.days, messageKind: messageKind || null },
      cohortSemantics: {
        dailyTrendTemplateReliabilityRetryFunnelTodayStripUnresolved:
          'slot_day_ist_booking_cohort',
        funnelStable: 'event_time_utc_created_at',
        topFailureReasons: 'event_time_utc_created_at',
        note:
          'Slot-day cohort attributes message events to step3Data.slotDate IST day via submission lookup; funnel uses raw createdAt window.'
      },
      range: {
        stableFrom: win.stable.from,
        stableTo: win.stable.to,
        todayFrom: win.today.from,
        todayTo: win.today.to
      },
      headerKpis: {
        bookingsToday: todayLiveStrip.bookings,
        attemptsToday: todayLiveStrip.attempts,
        deliveredToday: recipientTotals?.delivered ?? todayLiveStrip.delivered,
        failedToday: recipientTotals?.finalPermanentFailed ?? todayLiveStrip.failed,
        transientUnresolvedWindow: recipientTotals?.transientUnresolved ?? null,
        reconcilePendingWindow: recipientTotals?.reconcilePending ?? null,
        retryExhaustedToday: todayLiveStrip.retryExhausted,
        inFlightToday: todayLiveStrip.inFlight,
        unresolvedRecipientsWindow: unresolvedHeader,
        activeRecoveryJobs,
        recipientTotalsWindow: recipientTotals
      },
      funnelStable,
      templateReliabilityStable,
      dailyTrendStable,
      dailyTrendEventTime,
      topFailureReasonsStable,
      retryAttemptStable,
      todayLiveStrip
    }
  };
}

/* ============================================================================
 * Unresolved recipients (paginated, grouped, with submission enrichment)
 * ========================================================================= */

const UNRESOLVED_GROUPS = [
  'failed',
  'excluded',
  'exhausted',
  'not_accepted',
  'in_flight_stale',
  'reconciliation_pending',
  'all'
];

const EXCLUSION_CATEGORY_MAP = {
  policy_non_retryable: 'permanent_failure',
  permanent_failure: 'permanent_failure',
  dlr_failed_after_accept: 'dlr_failed_after_accept',
  webhook_stale_unresolved: 'webhook_stale_unresolved',
  in_flight_timeout: 'in_flight_timeout',
  promotion_superseded: 'promotion_superseded',
  missing_phone: 'invalid_recipient',
  missing_registered_submission: 'invalid_recipient',
  cooldown_blocked: 'cooldown',
  duplicate_retry_prevented: 'duplicate_protected',
  retry_eligibility_disabled: 'manually_disabled',
  already_delivered_or_read: 'already_resolved'
};

function classifyExclusionCategory(reason, status) {
  if (status === 'retry_exhausted') return 'retry_exhausted';
  if (reason && EXCLUSION_CATEGORY_MAP[reason]) return EXCLUSION_CATEGORY_MAP[reason];
  if (status === 'failed') return 'permanent_failure';
  return 'unresolved_other';
}

/**
 * One representative row per unresolved phone+messageKind, joined with FormSubmission.
 * Returns rich data for an operational recovery console.
 *
 * @param {{
 *   from?: Date|null, to?: Date|null,
 *   messageKind?: string|null,
 *   group?: 'failed'|'excluded'|'exhausted'|'not_accepted'|'in_flight_stale'|'all',
 *   page?: number, limit?: number,
 *   q?: string|null,
 *   inFlightStaleMinutes?: number,
 *   notAcceptedThresholdMinutes?: number
 * }} opts
 */
function reasonLabelFromAggRow(r) {
  const canon = canonical.toCanonicalExclusionReason({
    status: r.lastStatus,
    retryExclusionReason: r.lastExclusionReason,
    anyReconcilePending: r.anyReconcilePending
  });
  if (canon) return canon;
  if (r.anyReconcilePending) return canonical.OPS_EXCLUSION_TAXONOMY.reconcile_pending;
  if (r.anyReconcileDerived && r.anyTerminalFail) return 'reconcile_derived_failed';
  if (r.anyTerminalFail && !r.anyPermanent && !r.anyReconcilePending) return 'transient_unresolved';
  return r.anyExhausted
    ? 'retry_exhausted'
    : r.anyTerminalFail
      ? 'failed'
      : r.anyNotAccepted
        ? 'not_accepted'
        : r.anyInFlightStale
          ? 'in_flight_stale'
          : 'unknown';
}

/** After grouping, keep rows whose latest event time falls in [from, to] (inclusive). */
function lastEventInDateWindow(row, from, to) {
  if (!from && !to) return true;
  const t = row.lastCreatedAt ? new Date(row.lastCreatedAt).getTime() : NaN;
  if (Number.isNaN(t)) return false;
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
}

async function computeUnresolvedRecipients({
  from = null,
  to = null,
  messageKind = null,
  group = 'all',
  page = 1,
  limit = 50,
  q = null,
  cohortDateIso = null,
  inFlightStaleMinutes = parseInt(process.env.WHATSAPP_RECOVERY_INFLIGHT_STALE_MINUTES || '180', 10) || 180,
  notAcceptedThresholdMinutes = parseInt(process.env.WHATSAPP_NOT_ACCEPTED_THRESHOLD_MINUTES || '30', 10) || 30
} = {}) {
  if (messageKind && !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
    return { error: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}` };
  }
  const grp = String(group || 'all').toLowerCase();
  if (!UNRESOLVED_GROUPS.includes(grp)) {
    return { error: `Invalid group. Allowed: ${UNRESOLVED_GROUPS.join(', ')}` };
  }

  const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(String(page), 10) || 1, 1);
  const inFlightStaleBefore = new Date(Date.now() - inFlightStaleMinutes * 60 * 1000);
  const notAcceptedBefore = new Date(Date.now() - notAcceptedThresholdMinutes * 60 * 1000);

  /** Do not filter by createdAt here: unresolved flags need the full attempt history per
   *  phone+template. The UI date range is applied after grouping on lastCreatedAt. */
  const match = {
    ...(messageKind ? { messageKind } : {})
  };

  /** Collapse to one rep row per (phone, messageKind). Track per-group flags so the
   *  same dataset answers each tab without re-querying. */
  let cohortKeyFilter = null;
  if (cohortDateIso && /^\d{4}-\d{2}-\d{2}$/.test(String(cohortDateIso))) {
    const cohortKeys = await WhatsAppMessageEvent.aggregate([
      ...cohortAgg.annotateEventsWithSlotDayPipeline(messageKind, { strictSlotDay: true }),
      { $match: { slotDayIst: String(cohortDateIso) } },
      { $group: { _id: { phone: '$phone', messageKind: '$messageKind' } } }
    ]);
    cohortKeyFilter = new Set(
      cohortKeys.map((r) => `${r._id?.phone || ''}|${r._id?.messageKind || ''}`)
    );
  }

  const baseRows = await WhatsAppMessageEvent.aggregate([
    { $match: match },
    {
      $addFields: {
        isTerminalFailure: { $cond: [{ $in: ['$status', TERMINAL_FAILURE_STATUSES] }, 1, 0] },
        isExhausted: { $cond: [{ $eq: ['$status', 'retry_exhausted'] }, 1, 0] },
        isExcluded: { $cond: [{ $ne: ['$retryExclusionReason', null] }, 1, 0] },
        isInFlightStale: {
          $cond: [
            {
              $and: [
                { $in: ['$status', IN_FLIGHT_STATUSES] },
                { $lte: ['$createdAt', inFlightStaleBefore] }
              ]
            },
            1,
            0
          ]
        },
        isReconcilePending: {
          $cond: [{ $eq: ['$status', 'awaiting_final_dlr'] }, 1, 0]
        },
        isReconcileDerived: {
          $cond: [{ $eq: ['$reconcileDerivedFailure', true] }, 1, 0]
        },
        isPermanent: {
          $cond: [{ $eq: ['$terminalFailureKind', 'permanent'] }, 1, 0]
        },
        isNotAccepted: {
          $cond: [
            {
              $and: [
                { $in: ['$status', ['queued', 'submitted']] },
                { $eq: ['$providerAcceptedAt', null] },
                { $lte: ['$createdAt', notAcceptedBefore] }
              ]
            },
            1,
            0
          ]
        },
        isDelivered: { $cond: [{ $in: ['$status', DLR_DELIVERED_STATUSES] }, 1, 0] }
      }
    },
    {
      $group: {
        _id: { phone: '$phone', messageKind: '$messageKind' },
        anyTerminalFail: { $max: '$isTerminalFailure' },
        anyExhausted: { $max: '$isExhausted' },
        anyExcluded: { $max: '$isExcluded' },
        anyInFlightStale: { $max: '$isInFlightStale' },
        anyReconcilePending: { $max: '$isReconcilePending' },
        anyReconcileDerived: { $max: '$isReconcileDerived' },
        anyPermanent: { $max: '$isPermanent' },
        anyNotAccepted: { $max: '$isNotAccepted' },
        anyDelivered: { $max: '$isDelivered' },
        deliveredAt: { $max: '$deliveredAt' },
        readAt: { $max: '$readAt' },
        retryHistoryCount: { $sum: 1 },
        lastEventId: { $last: '$_id' },
        lastStatus: { $last: '$status' },
        lastAttemptNumber: { $last: '$attemptNumber' },
        lastRetrySource: { $last: '$retrySource' },
        lastRetryGroupId: { $last: '$retryGroupId' },
        lastExclusionReason: { $last: '$retryExclusionReason' },
        lastErrorMessage: { $last: '$errorMessage' },
        lastFormSubmissionId: { $last: '$formSubmissionId' },
        lastCreatedAt: { $last: '$createdAt' },
        anyRetryGroupId: { $first: '$retryGroupId' },
        firstCreatedAt: { $min: '$createdAt' }
      }
    },
    {
      $addFields: {
        isUnresolved: {
          $cond: [
            {
              $and: [
                { $eq: ['$anyDelivered', 0] },
                {
                  $or: [
                    { $eq: ['$anyTerminalFail', 1] },
                    { $eq: ['$anyExcluded', 1] },
                    { $eq: ['$anyInFlightStale', 1] },
                    { $eq: ['$anyReconcilePending', 1] },
                    { $eq: ['$anyNotAccepted', 1] }
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
    { $match: { isUnresolved: 1 } },
    { $sort: { lastCreatedAt: -1 } }
  ]);

  let windowRows = baseRows.filter((r) => lastEventInDateWindow(r, from, to));
  if (cohortKeyFilter) {
    windowRows = windowRows.filter((r) =>
      cohortKeyFilter.has(`${r._id?.phone || ''}|${r._id?.messageKind || ''}`)
    );
  }

  /** Group filter applied AFTER global totals so tab counters stay accurate when no text search. */
  let filtered = windowRows;
  if (grp !== 'all') {
    filtered = windowRows.filter((r) => {
      if (grp === 'failed') {
        return r.anyTerminalFail && !r.anyExhausted && !r.anyReconcilePending;
      }
      if (grp === 'excluded') return r.anyExcluded;
      if (grp === 'exhausted') return r.anyExhausted;
      if (grp === 'not_accepted') return r.anyNotAccepted;
      if (grp === 'reconciliation_pending') return r.anyReconcilePending;
      if (grp === 'in_flight_stale') return r.anyInFlightStale && !r.anyReconcilePending;
      return true;
    });
  }

  const qTrim = q != null && String(q).trim() ? String(q).trim().toLowerCase() : '';

  if (qTrim) {
    const subIdsForQ = [...new Set(filtered.map((r) => r.lastFormSubmissionId).filter(Boolean))];
    const subsForQ = subIdsForQ.length
      ? await FormSubmission.find({ _id: { $in: subIdsForQ } }).select('fullName').lean()
      : [];
    const nameBySubId = Object.fromEntries(subsForQ.map((s) => [String(s._id), s.fullName || '']));

    filtered = filtered.filter((r) => {
      const phone = String(r._id?.phone || '').toLowerCase();
      const template = String(r._id?.messageKind || '').toLowerCase();
      const name = String(nameBySubId[String(r.lastFormSubmissionId)] || '').toLowerCase();
      const err = String(r.lastErrorMessage || '').toLowerCase();
      const excl = String(r.lastExclusionReason || '').toLowerCase();
      const reason = String(reasonLabelFromAggRow(r) || '').toLowerCase();
      return [phone, template, name, err, excl, reason].some((field) => field.includes(qTrim));
    });
  }

  const totalsByGroup = {
    failed: 0,
    excluded: 0,
    exhausted: 0,
    not_accepted: 0,
    in_flight_stale: 0,
    reconciliation_pending: 0,
    all: qTrim ? filtered.length : windowRows.length
  };
  const totalsByExclusionReason = {};
  const totalsByExclusionCategory = {};
  const rowsForTotals = qTrim ? filtered : windowRows;
  rowsForTotals.forEach((r) => {
    if (r.anyTerminalFail && r.anyExhausted !== 1 && !r.anyReconcilePending) totalsByGroup.failed += 1;
    if (r.anyExcluded) totalsByGroup.excluded += 1;
    if (r.anyExhausted) totalsByGroup.exhausted += 1;
    if (r.anyNotAccepted) totalsByGroup.not_accepted += 1;
    if (r.anyReconcilePending) totalsByGroup.reconciliation_pending += 1;
    if (r.anyInFlightStale && !r.anyReconcilePending) totalsByGroup.in_flight_stale += 1;
    const reason = reasonLabelFromAggRow(r);
    totalsByExclusionReason[reason] = (totalsByExclusionReason[reason] || 0) + 1;
    const category = classifyExclusionCategory(r.lastExclusionReason, r.lastStatus);
    totalsByExclusionCategory[category] = (totalsByExclusionCategory[category] || 0) + 1;
  });

  const total = filtered.length;
  const skip = (safePage - 1) * safeLimit;
  const pageSlice = filtered.slice(skip, skip + safeLimit);

  const subIds = pageSlice.map((r) => r.lastFormSubmissionId).filter(Boolean);
  const subs = subIds.length
    ? await FormSubmission.find({ _id: { $in: subIds } })
        .select('fullName phone step3Data whatsappDeliveryStatus whatsappLastWebhookAt whatsappLastError whatsappRetryCount whatsappRetryKind lastWhatsappAttemptAt whatsappLastMessageId')
        .lean()
    : [];
  const subMap = Object.fromEntries(subs.map((s) => [String(s._id), s]));

  const rows = pageSlice.map((r) => {
    const phone = r._id.phone;
    const fs = r.lastFormSubmissionId ? subMap[String(r.lastFormSubmissionId)] : null;
    const reasonLabel = reasonLabelFromAggRow(r);
    const canonicalBucket = canonical.assignRecipientBucket({
      everDelivered: r.anyDelivered,
      finalPermanentFailed: r.anyPermanent || r.anyExhausted,
      anyReconcilePending: r.anyReconcilePending,
      finalUnresolved: 1,
      anyExcluded: r.anyExcluded,
      anyInFlight: r.anyInFlightStale,
      lastExclusionReason: r.lastExclusionReason,
      lastStatus: r.lastStatus
    });
    return {
      phone,
      name: fs?.fullName || null,
      messageKind: r._id.messageKind,
      canonicalBucket,
      canonicalExclusionReason: reasonLabel,
      attemptStage: r.lastRetrySource || null,
      lastAttemptNumber: r.lastAttemptNumber || null,
      lifecycleState: r.lastStatus || null,
      exclusionReason: r.lastExclusionReason || null,
      exclusionCategory: classifyExclusionCategory(r.lastExclusionReason, r.lastStatus),
      reason: reasonLabel,
      errorMessage: r.lastErrorMessage || fs?.whatsappLastError || null,
      everDeliveredAt: r.deliveredAt || r.readAt || null,
      retryExhausted: !!r.anyExhausted,
      lastAttemptAt: r.lastCreatedAt,
      firstAttemptAt: r.firstCreatedAt,
      retryHistoryCount: r.retryHistoryCount || 0,
      retryGroupId: r.lastRetryGroupId || r.anyRetryGroupId || null,
      lastEventId: r.lastEventId,
      formSubmissionId: r.lastFormSubmissionId || fs?._id || null,
      slotDate: fs?.step3Data?.slotDate || null,
      submissionDeliveryStatus: fs?.whatsappDeliveryStatus || null,
      submissionLastError: fs?.whatsappLastError || null,
      submissionRetryCount: fs?.whatsappRetryCount ?? null
    };
  });

  return {
    data: {
      filter: {
        from: from || null,
        to: to || null,
        messageKind: messageKind || null,
        group: grp,
        q: qTrim || null,
        inFlightStaleMinutes,
        notAcceptedThresholdMinutes
      },
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 0,
      totalsByGroup,
      totalsByExclusionReason,
      totalsByExclusionCategory,
      rows
    }
  };
}

module.exports = {
  ALLOWED_MESSAGE_KINDS,
  UNRESOLVED_GROUPS,
  EXCLUSION_CATEGORY_MAP,
  parseBoundaryDate,
  dateRangeFromQuery,
  parseIsoDateOnly,
  parseIsoMonth,
  istDayRangeFromIso,
  istMonthRangeFromIso,
  facetStatsPipeline,
  facetStatsToTotals,
  computeRetry2Exclusions,
  computeRetry2ExclusionsForPrefix,
  computeSummary,
  computeMonthOverview,
  computeDayOverview,
  buildScopeKey,
  buildClosedWindow,
  computeOperationalHealth,
  computeUnresolvedRecipients,
  classifyExclusionCategory,
  slotDayIstPrefixStages,
  computeDailyTrendEventTime,
  slotCohortPipelinePrefixFromStableWindow
};
