const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const MessagingCronRun = require('../models/MessagingCronRun');
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
const FormSubmission = require('../models/FormSubmission');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { buildSlotNotificationVariables } = require('../utils/slotNotificationFormatters');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const gupshupService = require('../services/gupshupService');
const { executeRetryWhatsAppBatch } = require('../services/retryWhatsAppBatch');
const {
  previewRetryPromotion,
  executeRetryAttempt,
  computeRetryCandidates
} = require('../services/whatsappRetryOrchestrator');
const {
  getRetryPolicy,
  isCampaignStrategy
} = require('../utils/whatsappRetryRules');
const { deriveSubmissionWaStatus } = require('../services/whatsappOpsStatus');
const IST_OFFSET_MINUTES = 330;

function clampInt(v, dflt, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, 1), max);
}

function dateRange(query) {
  const from = parseBoundaryDate(query.from, 'start');
  const to = parseBoundaryDate(query.to, 'end') || new Date();
  return { from, to };
}

function parseBoundaryDate(raw, mode) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  // HTML date inputs send YYYY-MM-DD without time. Treat them as full-day bounds.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const iso = mode === 'start' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

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

function facetStatsPipeline(match) {
  return [
    { $match: match },
    {
      $facet: {
        total: [{ $count: 'c' }],
        byKind: [{ $group: { _id: '$messageKind', c: { $sum: 1 } } }],
        byStatus: [{ $group: { _id: '$status', c: { $sum: 1 } } }],
        /** Accepted by Gupshup (API success path), any lifecycle stage before terminal send-fail */
        submittedAccepted: [{
          $match: { status: { $in: ['submitted', 'sent', 'delivered', 'read'] } }
        }, { $count: 'c' }],
        /** Still awaiting DLR past `submitted` */
        strictSubmitted: [{ $match: { status: 'submitted' } }, { $count: 'c' }],
        /** Webhook `sent` or later */
        sentCumulative: [{
          $match: { status: { $in: ['sent', 'delivered', 'read'] } }
        }, { $count: 'c' }],
        /** Device delivery or read */
        deliveredCumulative: [{
          $match: { status: { $in: ['delivered', 'read'] } }
        }, { $count: 'c' }],
        readStrict: [{ $match: { status: 'read' } }, { $count: 'c' }],
        failed: [{ $match: { status: { $in: ['failed', 'retry_exhausted'] } } }, { $count: 'c' }],
        retryExhausted: [{ $match: { status: 'retry_exhausted' } }, { $count: 'c' }],
        retried: [{ $match: { retryCountSnapshot: { $gt: 0 } } }, { $count: 'c' }],
        slotBookedAttempts: [{ $match: { messageKind: 'slot_booked' } }, { $count: 'c' }]
      }
    }
  ];
}

function facetStatsToTotals(facet) {
  return {
    whatsappAttempts: facet.total?.[0]?.c || 0,
    /** Funnel: messages accepted by provider (not send-failed / exhausted) */
    providerAcceptedCount: facet.submittedAccepted?.[0]?.c || 0,
    strictSubmittedCount: facet.strictSubmitted?.[0]?.c || 0,
    sentCount: facet.sentCumulative?.[0]?.c || 0,
    whatsappFailed: facet.failed?.[0]?.c || 0,
    /** Count of messages that reached device delivery (includes those later read) */
    deliveredCount: facet.deliveredCumulative?.[0]?.c || 0,
    readCount: facet.readStrict?.[0]?.c || 0,
    retried: facet.retried?.[0]?.c || 0,
    retryExhausted: facet.retryExhausted?.[0]?.c || 0,
    slotBookedAttempts: facet.slotBookedAttempts?.[0]?.c || 0
  };
}

function mapEventStatusToDeliveryStatus(status) {
  const s = status ? String(status).toLowerCase() : '';
  if (s === 'read') return 'read';
  if (s === 'delivered') return 'delivered';
  if (s === 'failed' || s === 'retry_exhausted') return 'failed';
  if (s === 'sent') return 'sent';
  if (s === 'submitted' || s === 'queued' || s === 'retry_pending') return 'submitted';
  return s || null;
}

const ALLOWED_MESSAGE_KINDS = ['slot_booked', 'pre4hr', 'meet', '30min'];

exports.getOpsMeta = (_req, res) => {
  res.json({
    success: true,
    data: {
      envHints: [
        'ENABLE_WHATSAPP',
        'GUPSHUP_API_KEY',
        'GUPSHUP_SOURCE',
        'GUPSHUP_TEMPLATE_REMINDER',
        'GUPSHUP_TEMPLATE_PRE4HR',
        'GUPSHUP_TEMPLATE_MEET',
        'GUPSHUP_TEMPLATE_30MIN',
        'WHATSAPP_CRON_SCHEDULE_COPY'
      ],
      templateKinds: [
        { id: 'slot_booked', label: 'Slot booked', description: 'Immediate confirmation after slot booking', retryPolicy: getRetryPolicy('slot_booked') },
        { id: 'pre4hr', label: '4hr reminder', description: 'Reminder sent around 4 hours before slot', retryPolicy: getRetryPolicy('pre4hr') },
        { id: 'meet', label: 'Meet link (~1hr)', description: 'Meeting link reminder sent around 1 hour before slot', retryPolicy: getRetryPolicy('meet') },
        { id: '30min', label: '30 min reminder', description: 'Final reminder sent around 30 minutes before slot', retryPolicy: getRetryPolicy('30min') }
      ]
    }
  });
};

exports.getSummary = async (req, res) => {
  try {
    const { from, to } = dateRange(req.query);
    const messageKind = req.query.messageKind ? String(req.query.messageKind).trim() : null;
    if (messageKind && !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
      return res.status(400).json({
        success: false,
        message: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}`
      });
    }
    const match = {};
    if (from || to) {
      match.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {})
      };
    }
    if (messageKind) {
      match.messageKind = messageKind;
    }

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
          failed: [{
            $match: { status: { $in: ['failed', 'retry_exhausted'] } }
          }, { $count: 'c' }],
          delivered: [{
            $match: { status: { $in: ['delivered', 'read'] } }
          }, { $count: 'c' }],
          read: [{
            $match: { status: 'read' }
          }, { $count: 'c' }],
          retryExhausted: [{
            $match: { status: 'retry_exhausted' }
          }, { $count: 'c' }],
          retried: [{
            $match: { retryCountSnapshot: { $gt: 0 } }
          }, { $count: 'c' }]
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

    const data = {
      meta: {
        selectedMessageKind: messageKind || null,
        attemptedRows: total
      },
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
        retryRatePct: total ? Math.round((retriedN / total) * 1000) / 10 : null,
        acceptedToDeliveredPct: acceptedN ? Math.round((deliveredN / acceptedN) * 1000) / 10 : null,
        deliveredToReadPct: deliveredN ? Math.round((readN / deliveredN) * 1000) / 10 : null,
        ...(messageKind ? {} : { cronSuccessRatePct: c.runs ? Math.round((c.ok / c.runs) * 1000) / 10 : null })
      },
      ...(messageKind
        ? {}
        : {
            cronRuns: {
              runs: c?.runs || 0,
              success: c?.ok || 0,
              failure: c?.failed || 0
            }
          }),
      byKind: (msgAgg.byKind || []).map((x) => ({ kind: x._id, count: x.c })),
      byStatus: (msgAgg.byStatus || []).map((x) => ({ status: x._id, count: x.c })),
      filter: { messageKind: messageKind || null },
      range: from ? { from, to } : { from: null, to }
    };

    res.json({
      success: true,
      data
    });
  } catch (e) {
    console.error('[whatsapp-ops summary]', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getCalendarMonthOverview = async (req, res) => {
  try {
    const monthIso = req.query.month || new Date().toISOString().slice(0, 7);
    const messageKind = req.query.messageKind ? String(req.query.messageKind).trim() : null;
    if (messageKind && !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
      return res.status(400).json({
        success: false,
        message: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}`
      });
    }
    const range = istMonthRangeFromIso(monthIso);
    if (!range) return res.status(400).json({ success: false, message: 'Invalid month format. Use YYYY-MM' });

    const eventMatch = {
      createdAt: { $gte: range.from, $lte: range.to },
      ...(messageKind ? { messageKind } : {})
    };
    const bookingMatch = {
      'step3Data.slotDate': { $gte: range.from, $lte: range.to }
    };

    const [eventsByDay, bookingsByDay] = await Promise.all([
      WhatsAppMessageEvent.aggregate([
        { $match: eventMatch },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }
            },
            attempts: { $sum: 1 },
            failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'retry_exhausted']] }, 1, 0] } },
            delivered: {
              $sum: {
                $cond: [{ $in: ['$status', ['delivered', 'read']] }, 1, 0]
              }
            },
            read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
            accepted: {
              $sum: {
                $cond: [{ $in: ['$status', ['submitted', 'sent', 'delivered', 'read']] }, 1, 0]
              }
            },
            sent: {
              $sum: {
                $cond: [{ $in: ['$status', ['sent', 'delivered', 'read']] }, 1, 0]
              }
            },
            retried: { $sum: { $cond: [{ $gt: ['$retryCountSnapshot', 0] }, 1, 0] } }
          }
        }
      ]),
      FormSubmission.aggregate([
        { $match: bookingMatch },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$step3Data.slotDate', timezone: 'Asia/Kolkata' }
              }
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

    return res.json({
      success: true,
      data: {
        filter: { month: range.isoMonth, messageKind: messageKind || null },
        range: { from: range.from, to: range.to },
        monthTotals,
        days
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * Day metrics bucket WhatsAppMessageEvent rows by IST calendar day of `createdAt` (send / row time),
 * not by `deliveredAt` — see model for webhook transition timestamps.
 */
exports.getCalendarDayOverview = async (req, res) => {
  try {
    const dateIso = req.query.date || new Date().toISOString().slice(0, 10);
    const selectedKind = req.query.messageKind ? String(req.query.messageKind).trim() : null;
    if (selectedKind && !ALLOWED_MESSAGE_KINDS.includes(selectedKind)) {
      return res.status(400).json({
        success: false,
        message: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}`
      });
    }
    const range = istDayRangeFromIso(dateIso);
    if (!range) return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD' });

    const baseMatch = { createdAt: { $gte: range.from, $lte: range.to } };
    const filteredMatch = { ...baseMatch, ...(selectedKind ? { messageKind: selectedKind } : {}) };

    const attemptFacet = [
      { $match: filteredMatch },
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
      FormSubmission.countDocuments({ 'step3Data.slotDate': { $gte: range.from, $lte: range.to } }),
      WhatsAppMessageEvent.aggregate(facetStatsPipeline(baseMatch)),
      WhatsAppMessageEvent.aggregate(facetStatsPipeline(filteredMatch)),
      WhatsAppMessageEvent.aggregate(attemptFacet),
      WhatsAppMessageEvent.aggregate([
        { $match: { ...filteredMatch, status: { $in: ['delivered', 'read'] } } },
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

    return res.json({
      success: true,
      data: {
        filter: { date: range.isoDate, messageKind: selectedKind || null },
        range: { from: range.from, to: range.to },
        bookedSlotsCount,
        overall,
        selectedKindMetrics: filtered,
        byKind,
        byStatus,
        byAttempt,
        uniqueRecipientsDeliveredRead: uniqDelivered[0]?.c || 0
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.listCronRuns = async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 25, 100);
    const page = clampInt(req.query.page, 1, 5000);
    const skip = (page - 1) * limit;
    const filter = {};
    const { from, to } = dateRange(req.query);
    if (from) filter.startedAt = { $gte: from, $lte: to };
    if (req.query.jobKey) filter.jobKey = req.query.jobKey;
    if (req.query.success === 'true') filter.success = true;
    if (req.query.success === 'false') filter.success = false;

    const [runs, total] = await Promise.all([
      MessagingCronRun.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit).lean(),
      MessagingCronRun.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: runs,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
      total
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getCronRunDetail = async (req, res) => {
  try {
    const run = await MessagingCronRun.findById(req.params.id).lean();
    if (!run) return res.status(404).json({ success: false, message: 'Not found' });
    const events = await WhatsAppMessageEvent.find({ cronRunId: run._id })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ success: true, data: { run, linkedEvents: events } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listMessages = async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 25, 100);
    const page = clampInt(req.query.page, 1, 5000);
    const skip = (page - 1) * limit;
    const clauses = [];
    const { from, to } = dateRange(req.query);
    const base = {};
    if (from || to) {
      base.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {})
      };
    }
    if (req.query.phone) base.phone = String(req.query.phone).replace(/\D/g, '').slice(-10);
    if (req.query.messageKind) base.messageKind = req.query.messageKind;
    if (req.query.status) {
      const parts = String(req.query.status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 1) base.status = { $in: parts };
      else base.status = parts[0];
    }
    if (req.query.cronJobKey) base.cronJobKey = req.query.cronJobKey;
    if (req.query.retryGroupId && mongoose.Types.ObjectId.isValid(String(req.query.retryGroupId))) {
      base.retryGroupId = new mongoose.Types.ObjectId(String(req.query.retryGroupId));
    }
    if (req.query.attemptNumber != null && req.query.attemptNumber !== '') {
      const an = parseInt(String(req.query.attemptNumber), 10);
      if (an >= 1 && an <= 3) base.attemptNumber = an;
    }
    if (req.query.retryEligible === 'true') base.retryEligible = true;
    if (req.query.retryEligible === 'false') base.retryEligible = false;
    if (req.query.gupshupMessageId) base.gupshupMessageId = req.query.gupshupMessageId;
    if (Object.keys(base).length) clauses.push(base);

    if (req.query.name && String(req.query.name).trim()) {
      const re = new RegExp(String(req.query.name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const subs = await FormSubmission.find({ fullName: re }).select('_id phone').limit(3000).lean();
      const idSet = subs.map((s) => s._id);
      const phones = subs.map((s) => s.phone);
      clauses.push({
        $or: [{ formSubmissionId: { $in: idSet } }, { phone: { $in: phones } }]
      });
    }

    const filter = clauses.length <= 1 ? (clauses[0] || {}) : { $and: clauses };

    let total;
    let events;
    [events, total] = await Promise.all([
      WhatsAppMessageEvent.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      WhatsAppMessageEvent.countDocuments(filter)
    ]);

    const subIds = [...new Set(events.map((e) => e.formSubmissionId).filter(Boolean))];
    const subs = subIds.length
      ? await FormSubmission.find({ _id: { $in: subIds } })
          .select('fullName phone step3Data whatsappDeliveryStatus whatsappLastWebhookAt whatsappLastError whatsappRetryCount whatsappRetryKind lastWhatsappAttemptAt whatsappLastMessageId')
          .lean()
      : [];
    const subMap = Object.fromEntries(subs.map((s) => [String(s._id), s]));

    const rows = events.map((e) => {
      const fs = e.formSubmissionId ? subMap[String(e.formSubmissionId)] : null;
      const eventStatus = e.status || null;
      const deliveryStatus = mapEventStatusToDeliveryStatus(eventStatus);
      const retryCount = Number.isFinite(e.retryCountSnapshot)
        ? e.retryCountSnapshot
        : (Number.isFinite(fs?.whatsappRetryCount) ? fs.whatsappRetryCount : 0);
      const failureReason = e.errorMessage || fs?.whatsappLastError || null;
      return {
        ...e,
        userName: fs?.fullName || fs?.step1Data?.fullName || null,
        slotDate: fs?.step3Data?.slotDate || null,
        slotId: fs?.step3Data?.selectedSlot || null,
        submissionDeliveryStatus: fs?.whatsappDeliveryStatus,
        submissionLastWebhookAt: fs?.whatsappLastWebhookAt,
        derivedStatus: fs ? deriveSubmissionWaStatus(fs) : null,
        whatsappRetryCountSnap: fs?.whatsappRetryCount,
        deliveryStatus,
        failureReason,
        retryCount,
        sentAt: e.sentAt || e.createdAt || null
      };
    });

    res.json({
      success: true,
      data: rows,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getMessageTimeline = async (req, res) => {
  try {
    const ev = await WhatsAppMessageEvent.findById(req.params.id).lean();
    if (!ev) return res.status(404).json({ success: false, message: 'Not found' });
    const or = [{ phone: ev.phone, receivedAt: { $gte: new Date(ev.createdAt) } }];
    if (ev.gupshupMessageId) or.push({ messageId: ev.gupshupMessageId });

    const webhooks = await WhatsAppWebhookEvent.find({ $or: or })
      .sort({ receivedAt: 1 })
      .limit(200)
      .lean();

    let submission = null;
    if (ev.formSubmissionId) {
      submission = await FormSubmission.findById(ev.formSubmissionId).lean();
    }

    res.json({
      success: true,
      data: { event: ev, webhooks, submissionSummary: submission }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.retriesAnalytics = async (req, res) => {
  try {
    const evtMatch = {};
    const { from, to } = dateRange(req.query);
    if (from) evtMatch.createdAt = { $gte: from, $lte: to };

    const [rollup] = await WhatsAppMessageEvent.aggregate([
      { $match: evtMatch },
      {
        $facet: {
          exhaustedSamples: [{
            $match: { status: 'retry_exhausted' }
          }, { $sort: { createdAt: -1 } }, { $limit: 50 }],
          exhaustedCount: [{
            $match: { status: 'retry_exhausted' }
          }, { $count: 'c' }],
          avgRetrySnap: [{
            $group: { _id: null, avg: { $avg: '$retryCountSnapshot' }, n: { $sum: 1 } }
          }],
          failWithRetry: [{
            $match: { retryCountSnapshot: { $gt: 0 } }
          }, { $count: 'c' }],
          kindBreakdown: [{ $group: { _id: '$messageKind', c: { $sum: 1 } } }]
        }
      }
    ]);

    const exhaustedSamples = (rollup.exhaustedSamples || []).map((e) => ({
      phone: e.phone,
      messageKind: e.messageKind,
      errorMessage: e.errorMessage,
      createdAt: e.createdAt,
      retryCountSnapshot: e.retryCountSnapshot
    }));

    const retrySuccessMatch = {
      ...(from ? { createdAt: { $gte: from, $lte: to } } : {}),
      status: { $in: ['submitted', 'sent', 'delivered', 'read'] },
      retryCountSnapshot: { $gt: 0 }
    };

    let successAfterRetriesBySnap = [];
    try {
      successAfterRetriesBySnap = await WhatsAppMessageEvent.aggregate([
        { $match: retrySuccessMatch },
        { $group: { _id: '$retryCountSnapshot', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]);
    } catch {
      successAfterRetriesBySnap = [];
    }

    const exhaustedTotal = rollup.exhaustedCount[0]?.c || 0;

    res.json({
      success: true,
      data: {
        exhaustedCount: exhaustedTotal,
        exhaustedSamples,
        averageRetrySnap: rollup.avgRetrySnap[0]?.avg || null,
        kindBreakdown: rollup.kindBreakdown.map((x) => ({ kind: x._id, count: x.c })),
        successAfterRetriesBySnap,
        totals: {
          exhausted: exhaustedTotal,
          eventsWithRetries: rollup.failWithRetry[0]?.c || 0
        }
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listWebhooks = async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 25, 100);
    const page = clampInt(req.query.page, 1, 5000);
    const skip = (page - 1) * limit;
    const filter = {};
    const { from, to } = dateRange(req.query);
    if (from) filter.receivedAt = { $gte: from, $lte: to };
    if (req.query.phone) filter.phone = String(req.query.phone).replace(/\D/g, '').slice(-10);
    if (req.query.messageId) filter.messageId = req.query.messageId;

    const [rows, total] = await Promise.all([
      WhatsAppWebhookEvent.find(filter).sort({ receivedAt: -1 }).skip(skip).limit(limit).lean(),
      WhatsAppWebhookEvent.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: rows,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.failuresRollup = async (req, res) => {
  try {
    const match = { errorMessage: { $nin: [null, ''] } };
    const { from, to } = dateRange(req.query);
    if (from) match.createdAt = { $gte: from, $lte: to };

    const groups = await WhatsAppMessageEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $substrCP: ['$errorMessage', 0, 200] },
          count: { $sum: 1 },
          latest: { $max: '$createdAt' },
          sampleId: { $first: '$_id' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 80 }
    ]);

    res.json({ success: true, data: groups });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

function csvEscape(s) {
  if (s == null) return '';
  const t = String(s).replace(/"/g, '""');
  return `"${t}"`;
}

exports.exportCsv = async (req, res) => {
  try {
    const type = (req.query.type || 'messages').toLowerCase();
    const limit = clampInt(req.query.limit, 5000, 20000);

    let rows = [];
    if (type === 'messages') {
      rows = await WhatsAppMessageEvent.find().sort({ createdAt: -1 }).limit(limit).lean();
    } else if (type === 'cron') {
      rows = await MessagingCronRun.find().sort({ startedAt: -1 }).limit(limit).lean();
    } else if (type === 'webhooks') {
      rows = await WhatsAppWebhookEvent.find().sort({ receivedAt: -1 }).limit(limit).lean();
    } else if (type === 'failures') {
      rows = await WhatsAppMessageEvent.find({ errorMessage: { $nin: [null, ''] } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    } else {
      return res.status(400).json({ success: false, message: 'Invalid type' });
    }

    if (rows.length === 0) {
      res.header('Content-Type', 'text/csv');
      return res.send('');
    }

    const keys = Object.keys(rows[0]).filter((k) => !['__v'].includes(k));
    const headerLine = keys.join(',');
    const lines = rows.map((r) =>
      keys
        .map((k) => {
          let v = r[k];
          if (v instanceof Date) v = v.toISOString();
          if (v && typeof v === 'object') v = JSON.stringify(v);
          return csvEscape(v);
        })
        .join(',')
    );

    const filename = `${type}-export-${Date.now()}.csv`;
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send([headerLine, ...lines].join('\n'));
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

function dispatchKindToSendFn(kind) {
  switch (kind) {
    case 'slot_booked':
      return gupshupService.sendSlotBookedWhatsApp;
    case 'pre4hr':
      return gupshupService.sendPre4HrReminderWhatsApp;
    case 'meet':
      return gupshupService.sendMeetLinkWhatsApp;
    case '30min':
      return gupshupService.sendReminder30MinWhatsApp;
    default:
      return null;
  }
}

exports.manualResend = async (req, res) => {
  try {
    const { phone, formSubmissionId, messageKind } = req.body || {};
    let sub = null;
    if (formSubmissionId && mongoose.Types.ObjectId.isValid(String(formSubmissionId))) {
      sub = await FormSubmission.findById(formSubmissionId).lean();
    } else if (phone) {
      const p = String(phone).replace(/\D/g, '').slice(-10);
      sub = await FormSubmission.findOne({ phone: p }).lean();
    }
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });
    const kind = messageKind || 'slot_booked';
    const sendFn = dispatchKindToSendFn(kind);
    if (!sendFn) return res.status(400).json({ success: false, message: 'Invalid messageKind' });

    const withMeetingLink = kind === 'meet' || kind === '30min';
    const vars = buildSlotNotificationVariables(sub, { withMeetingLink });
    const r = await safeSendWhatsApp({
      phone10: sub.phone,
      formSubmissionId: sub._id,
      vars,
      retryKind: kind,
      source: 'admin_manual',
      cronRunId: null,
      cronJobKey: null,
      sendFn
    });

    res.json({ success: !!r.success, data: r });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.previewRetries = async (req, res) => {
  try {
    const retryGroupId = req.query.retryGroupId;
    const promoteToAttempt = parseInt(String(req.query.promoteToAttempt || req.query.promote || '2'), 10);
    if (!retryGroupId || !mongoose.Types.ObjectId.isValid(String(retryGroupId))) {
      return res.status(400).json({ success: false, message: 'Valid retryGroupId query param required' });
    }
    const group = await WhatsAppRetryGroup.findById(retryGroupId).select('messageKind').lean();
    if (!group) return res.status(404).json({ success: false, message: 'Retry group not found' });
    if (!isCampaignStrategy(group.messageKind)) {
      return res.json({
        success: true,
        data: {
          retryGroupId,
          promoteToAttempt,
          dupBlocked: true,
          candidateCount: 0,
          phonesSample: [],
          blockedReason: 'slot_booked_uses_immediate_retry_only'
        }
      });
    }
    const data = await previewRetryPromotion(retryGroupId, promoteToAttempt);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.executeRetries = async (req, res) => {
  try {
    const confirm = req.headers['x-whatsapps-confirm'] || req.headers['x-whatsapp-ops-confirm'];
    if (!confirm || String(confirm).trim().toUpperCase() !== 'RETRY') {
      return res.status(403).json({
        success: false,
        message: 'Send header x-whatsapp-ops-confirm: RETRY'
      });
    }

    const { retryGroupId, promoteToAttempt } = req.body || {};
    let attemptBatchId = req.body && req.body.attemptBatchId;
    if (!retryGroupId || !mongoose.Types.ObjectId.isValid(String(retryGroupId))) {
      return res.status(400).json({ success: false, message: 'retryGroupId required in body' });
    }
    const group = await WhatsAppRetryGroup.findById(retryGroupId).select('messageKind').lean();
    if (!group) return res.status(404).json({ success: false, message: 'Retry group not found' });
    if (!isCampaignStrategy(group.messageKind)) {
      return res.status(400).json({
        success: false,
        message: 'slot_booked is transactional and does not support campaign retry execute'
      });
    }
    const pta = parseInt(String(promoteToAttempt || ''), 10);
    if (pta !== 2 && pta !== 3) {
      return res.status(400).json({ success: false, message: 'promoteToAttempt must be 2 or 3' });
    }
    if (attemptBatchId != null && attemptBatchId !== '' && !mongoose.Types.ObjectId.isValid(String(attemptBatchId))) {
      return res.status(400).json({ success: false, message: 'Invalid attemptBatchId' });
    }
    if (attemptBatchId) {
      attemptBatchId = new mongoose.Types.ObjectId(String(attemptBatchId));
    }

    const data = await executeRetryAttempt({
      retryGroupId,
      nextAttempt: pta,
      attemptBatchId: attemptBatchId || undefined,
      source: 'retry_api',
      cronRunId: null,
      cronJobKey: null,
      requireRegistered: true
    });

    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.getRetryGroupDetail = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const group = await WhatsAppRetryGroup.findById(id).lean();
    if (!group) return res.status(404).json({ success: false, message: 'Not found' });

    const [c1, c2, c3, next2, next3] = await Promise.all([
      WhatsAppMessageEvent.countDocuments({ retryGroupId: group._id, attemptNumber: 1 }),
      WhatsAppMessageEvent.countDocuments({ retryGroupId: group._id, attemptNumber: 2 }),
      WhatsAppMessageEvent.countDocuments({ retryGroupId: group._id, attemptNumber: 3 }),
      computeRetryCandidates(group._id, 1),
      computeRetryCandidates(group._id, 2)
    ]);

    return res.json({
      success: true,
      data: {
        group,
        retryPolicy: getRetryPolicy(group.messageKind),
        countsByAttempt: { 1: c1, 2: c2, 3: c3 },
        previewNextAttempt2: { candidateCount: next2.candidateCount },
        previewNextAttempt3: { candidateCount: next3.candidateCount }
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

function emptyAttemptBuckets() {
  return {
    targeted: 0,
    submitted: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    inFlight: 0
  };
}

exports.getAttemptAnalytics = async (req, res) => {
  try {
    const messageKind = req.query.messageKind ? String(req.query.messageKind).trim() : null;
    if (!messageKind || !ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
      return res.status(400).json({
        success: false,
        message: `messageKind query param required. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}`
      });
    }
    const dateIso = req.query.date ? String(req.query.date).trim().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const range = istDayRangeFromIso(dateIso);
    if (!range) return res.status(400).json({ success: false, message: 'Invalid date. Use YYYY-MM-DD (IST anchor)' });

    const match = {
      createdAt: { $gte: range.from, $lte: range.to },
      messageKind
    };

    if (req.query.retryGroupId && mongoose.Types.ObjectId.isValid(String(req.query.retryGroupId))) {
      match.retryGroupId = new mongoose.Types.ObjectId(String(req.query.retryGroupId));
    }
    if (req.query.attemptNumber != null && req.query.attemptNumber !== '') {
      const an = parseInt(String(req.query.attemptNumber), 10);
      if (an >= 1 && an <= 3) match.attemptNumber = an;
    }

    const rows = await WhatsAppMessageEvent.aggregate([
      { $match: match },
      {
        $facet: {
          perAttempt: [
            {
              $group: {
                _id: '$attemptNumber',
                targeted: { $sum: 1 },
                submitted: {
                  $sum: {
                    $cond: [{ $in: ['$status', ['submitted', 'sent', 'delivered', 'read']] }, 1, 0]
                  }
                },
                sent: {
                  $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read']] }, 1, 0] }
                },
                delivered: {
                  $sum: { $cond: [{ $in: ['$status', ['delivered', 'read']] }, 1, 0] }
                },
                read: { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
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
          ],
          uniqDeliv: [
            { $match: { status: { $in: ['delivered', 'read'] } } },
            { $group: { _id: '$phone' } },
            { $count: 'c' }
          ]
        }
      }
    ]);

    const facet = rows[0] || {};
    const byAttemptRaw = facet.perAttempt || [];
    const byAttempt = {
      1: emptyAttemptBuckets(),
      2: emptyAttemptBuckets(),
      3: emptyAttemptBuckets()
    };
    byAttemptRaw.forEach((row) => {
      const k = row._id;
      if (!byAttempt[k]) return;
      byAttempt[k] = {
        targeted: row.targeted || 0,
        submitted: row.submitted || 0,
        sent: row.sent || 0,
        delivered: row.delivered || 0,
        read: row.read || 0,
        failed: row.failed || 0,
        inFlight: row.inFlight || 0
      };
    });

    return res.json({
      success: true,
      data: {
        filter: { date: range.isoDate, messageKind, retryGroupId: match.retryGroupId || null, attemptNumber: match.attemptNumber || null },
        range: { from: range.from, to: range.to },
        retryPolicy: getRetryPolicy(messageKind),
        byAttempt,
        uniqueRecipientsDeliveredRead: facet.uniqDeliv?.[0]?.c || 0
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.triggerRetryBatch = async (req, res) => {
  try {
    const confirm = req.headers['x-whatsapps-confirm'] || req.headers['x-whatsapp-ops-confirm'];
    if (!confirm || String(confirm).trim().toUpperCase() !== 'RETRY') {
      return res.status(403).json({
        success: false,
        message: 'Send header x-whatsapp-ops-confirm: RETRY'
      });
    }

    let cronRun = await MessagingCronRun.create({
      jobKey: 'retry_whatsapp',
      startedAt: new Date(),
      success: false,
      trigger: 'manual',
      triggeredBy: req.admin?.username || 'admin',
      stats: {}
    });

    try {
      const batch = await executeRetryWhatsAppBatch(cronRun._id);
      const finishedAt = new Date();
      const durationMs = finishedAt - new Date(cronRun.startedAt).getTime();
      await MessagingCronRun.updateOne(
        { _id: cronRun._id },
        {
          $set: {
            finishedAt,
            durationMs,
            success: true,
            stats: {
              found: batch.found,
              groupsTouched: batch.groupsTouched,
              smsSent: 0,
              smsFailed: 0,
              waAttempted: batch.attempted,
              waSucceeded: batch.succeeded,
              waFailed: batch.failed,
              retriesAttempted: batch.attempted,
              flagsUpdated: 0
            }
          }
        }
      );

      res.json({
        success: true,
        data: batch
      });
    } catch (e) {
      const finishedAt = new Date();
      await MessagingCronRun.updateOne(
        { _id: cronRun._id },
        {
          $set: {
            finishedAt,
            durationMs: finishedAt - new Date(cronRun.startedAt).getTime(),
            success: false,
            errorSummary: e.message
          }
        }
      );
      throw e;
    }
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
