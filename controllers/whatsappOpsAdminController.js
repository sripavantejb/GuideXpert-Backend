const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const MessagingCronRun = require('../models/MessagingCronRun');
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
const FormSubmission = require('../models/FormSubmission');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const WhatsAppOpsChartSnapshot = require('../models/WhatsAppOpsChartSnapshot');
const WhatsAppManualRecoveryJob = require('../models/WhatsAppManualRecoveryJob');
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
const opsAggregates = require('../services/whatsappOpsAggregates');
const manualRecoveryService = require('../services/whatsappManualRecovery');
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
    const result = await opsAggregates.computeSummary({ from, to, messageKind });
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    res.json({ success: true, data: result.data });
  } catch (e) {
    console.error('[whatsapp-ops summary]', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.getCalendarMonthOverview = async (req, res) => {
  try {
    const monthIso = req.query.month || new Date().toISOString().slice(0, 7);
    const messageKind = req.query.messageKind ? String(req.query.messageKind).trim() : null;
    const result = await opsAggregates.computeMonthOverview({ monthIso, messageKind });
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: result.data });
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
    const result = await opsAggregates.computeDayOverview({ dateIso, messageKind: selectedKind });
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: result.data });
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

    const retry2Exclusions = await computeRetry2Exclusions(match, byAttempt);

    return res.json({
      success: true,
      data: {
        filter: { date: range.isoDate, messageKind, retryGroupId: match.retryGroupId || null, attemptNumber: match.attemptNumber || null },
        range: { from: range.from, to: range.to },
        retryPolicy: getRetryPolicy(messageKind),
        byAttempt,
        retry2Exclusions,
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

/**
 * Compute aggregate(s) for the requested scope and persist a snapshot keyed by
 * deterministic scopeKey. Always writes a single row per scope (upsert), so a
 * subsequent capture refreshes the chart payload while live aggregates stay
 * available on the legacy endpoints.
 *
 * Body / query params:
 *   - scope: 'summary' | 'month' | 'day' | 'all' (defaults to 'summary')
 *   - month: YYYY-MM (when scope=month or all)
 *   - date: YYYY-MM-DD (when scope=day or all)
 *   - from / to: ISO strings (when scope=summary or all)
 *   - messageKind: optional filter
 */
exports.captureSnapshot = async (req, res) => {
  try {
    const params = { ...req.query, ...(req.body || {}) };
    const scope = String(params.scope || 'summary').toLowerCase();
    const messageKind = params.messageKind ? String(params.messageKind).trim() : null;
    const username = req.admin?.username || null;
    const captures = [];
    const errors = [];

    const captureOne = async (entry) => {
      const { scopeKey, scope: scopeName, payload, range } = entry;
      const doc = await WhatsAppOpsChartSnapshot.findOneAndUpdate(
        { scopeKey },
        {
          $set: {
            scopeKey,
            scope: scopeName,
            messageKind: messageKind || null,
            range,
            payload,
            capturedAt: new Date(),
            capturedBy: username
          }
        },
        { upsert: true, new: true }
      ).lean();
      captures.push({
        scopeKey: doc.scopeKey,
        scope: doc.scope,
        capturedAt: doc.capturedAt,
        messageKind: doc.messageKind || null,
        range: doc.range || {}
      });
    };

    const wantSummary = scope === 'summary' || scope === 'all';
    const wantMonth = scope === 'month' || scope === 'all';
    const wantDay = scope === 'day' || scope === 'all';

    if (wantSummary) {
      const from = opsAggregates.parseBoundaryDate(params.from, 'start');
      const to = opsAggregates.parseBoundaryDate(params.to, 'end') || new Date();
      const summary = await opsAggregates.computeSummary({ from, to, messageKind });
      if (summary.error) {
        errors.push({ scope: 'summary', message: summary.error });
      } else {
        await captureOne({
          scopeKey: opsAggregates.buildScopeKey({
            scope: 'summary',
            messageKind,
            fromIso: from ? from.toISOString() : '',
            toIso: to ? to.toISOString() : ''
          }),
          scope: 'summary',
          payload: summary.data,
          range: {
            fromIso: from ? from.toISOString() : null,
            toIso: to ? to.toISOString() : null,
            monthIso: null,
            dateIso: null
          }
        });
      }
    }

    if (wantMonth) {
      const monthIso = params.month || new Date().toISOString().slice(0, 7);
      const month = await opsAggregates.computeMonthOverview({ monthIso, messageKind });
      if (month.error) {
        errors.push({ scope: 'month', message: month.error });
      } else {
        await captureOne({
          scopeKey: opsAggregates.buildScopeKey({ scope: 'month', messageKind, monthIso }),
          scope: 'month',
          payload: month.data,
          range: { monthIso, dateIso: null, fromIso: null, toIso: null }
        });
      }
    }

    if (wantDay) {
      const dateIso = params.date || new Date().toISOString().slice(0, 10);
      const day = await opsAggregates.computeDayOverview({ dateIso, messageKind });
      if (day.error) {
        errors.push({ scope: 'day', message: day.error });
      } else {
        await captureOne({
          scopeKey: opsAggregates.buildScopeKey({ scope: 'day', messageKind, dateIso }),
          scope: 'day',
          payload: day.data,
          range: { dateIso, monthIso: null, fromIso: null, toIso: null }
        });
      }
    }

    if (!captures.length && errors.length) {
      return res.status(400).json({ success: false, message: errors[0].message, errors });
    }

    return res.json({
      success: true,
      data: {
        captures,
        capturedAt: captures.length ? captures[0].capturedAt : new Date(),
        capturedBy: username,
        errors: errors.length ? errors : undefined
      }
    });
  } catch (e) {
    console.error('[whatsapp-ops captureSnapshot]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * Read the latest snapshot(s). Caller may either:
 *   - pass scopeKey directly, OR
 *   - pass { scope, messageKind, month, date, from, to } to derive scopeKey, OR
 *   - pass scope=all to fetch summary/month/day in one call.
 */
exports.getLatestSnapshot = async (req, res) => {
  try {
    const params = req.query || {};
    const messageKind = params.messageKind ? String(params.messageKind).trim() : null;

    if (params.scopeKey) {
      const doc = await WhatsAppOpsChartSnapshot.findOne({ scopeKey: String(params.scopeKey) }).lean();
      if (!doc) return res.json({ success: true, data: null });
      return res.json({ success: true, data: doc });
    }

    const scope = String(params.scope || 'summary').toLowerCase();
    const requested = scope === 'all' ? ['summary', 'month', 'day'] : [scope];
    const out = {};

    /* eslint-disable no-await-in-loop */
    for (const s of requested) {
      let scopeKey = null;
      if (s === 'summary') {
        const from = opsAggregates.parseBoundaryDate(params.from, 'start');
        const to = opsAggregates.parseBoundaryDate(params.to, 'end') || null;
        scopeKey = opsAggregates.buildScopeKey({
          scope: 'summary',
          messageKind,
          fromIso: from ? from.toISOString() : '',
          toIso: to ? to.toISOString() : ''
        });
      } else if (s === 'month') {
        const monthIso = params.month || new Date().toISOString().slice(0, 7);
        scopeKey = opsAggregates.buildScopeKey({ scope: 'month', messageKind, monthIso });
      } else if (s === 'day') {
        const dateIso = params.date || new Date().toISOString().slice(0, 10);
        scopeKey = opsAggregates.buildScopeKey({ scope: 'day', messageKind, dateIso });
      }
      if (!scopeKey) {
        out[s] = null;
        continue;
      }
      const doc = await WhatsAppOpsChartSnapshot.findOne({ scopeKey }).lean();
      out[s] = doc || null;
    }
    /* eslint-enable no-await-in-loop */

    if (scope === 'all') {
      return res.json({ success: true, data: out });
    }
    return res.json({ success: true, data: out[scope] || null });
  } catch (e) {
    console.error('[whatsapp-ops getLatestSnapshot]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * Build the unresolved candidates list for a single template. Read-only.
 * Body / query: { messageKind, from, to }
 */
exports.previewManualRecovery = async (req, res) => {
  try {
    const params = { ...req.query, ...(req.body || {}) };
    const messageKind = params.messageKind ? String(params.messageKind).trim() : null;
    if (!messageKind) {
      return res.status(400).json({ success: false, message: 'messageKind is required' });
    }
    const fromAt = opsAggregates.parseBoundaryDate(params.from, 'start');
    const toAt = opsAggregates.parseBoundaryDate(params.to, 'end');
    const result = await manualRecoveryService.buildPreview({ messageKind, fromAt, toAt });
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: result.data });
  } catch (e) {
    console.error('[whatsapp-ops previewManualRecovery]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * Create a manual recovery job and start async execution.
 * Body: { messageKind, from?, to?, phones? } — when phones present, restrict to those.
 */
exports.startManualRecovery = async (req, res) => {
  try {
    const body = req.body || {};
    const messageKind = body.messageKind ? String(body.messageKind).trim() : null;
    if (!messageKind) {
      return res.status(400).json({ success: false, message: 'messageKind is required' });
    }
    const fromAt = opsAggregates.parseBoundaryDate(body.from, 'start');
    const toAt = opsAggregates.parseBoundaryDate(body.to, 'end');
    const explicitPhones = Array.isArray(body.phones)
      ? body.phones.map((p) => String(p || '').replace(/\D/g, '').slice(-10)).filter(Boolean)
      : null;

    const preview = await manualRecoveryService.buildPreview({ messageKind, fromAt, toAt });
    if (preview.error) {
      return res.status(400).json({ success: false, message: preview.error });
    }
    let candidates = preview.data.candidates || [];
    if (explicitPhones && explicitPhones.length) {
      const allow = new Set(explicitPhones);
      candidates = candidates.filter((c) => allow.has(c.phone));
    }
    if (!candidates.length) {
      return res.status(400).json({
        success: false,
        message: 'No unresolved recipients to recover'
      });
    }

    const phones = candidates.map((c) => c.phone);
    const job = await WhatsAppManualRecoveryJob.create({
      status: 'queued',
      messageKind,
      fromAt: fromAt || null,
      toAt: toAt || null,
      candidatePhones: phones,
      createdBy: req.admin?.username || null,
      counters: {
        targeted: phones.length,
        attempted: 0,
        apiAccepted: 0,
        sendFailed: 0,
        skippedAlreadyDelivered: preview.data.skippedAlreadyDelivered || 0,
        skippedGlobalRecentSuccess: preview.data.skippedGlobalRecentSuccess || 0,
        skippedInFlightDuplicate: preview.data.skippedInFlightDuplicate || 0,
        remaining: phones.length
      }
    });

    manualRecoveryService.startJobAsync(job._id);

    return res.json({
      success: true,
      data: {
        jobId: job._id,
        status: job.status,
        targeted: phones.length,
        skippedAlreadyDelivered: preview.data.skippedAlreadyDelivered || 0,
        skippedGlobalRecentSuccess: preview.data.skippedGlobalRecentSuccess || 0,
        skippedInFlightDuplicate: preview.data.skippedInFlightDuplicate || 0
      }
    });
  } catch (e) {
    console.error('[whatsapp-ops startManualRecovery]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.getManualRecoveryJob = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const doc = await WhatsAppManualRecoveryJob.findById(id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });

    /** Recompute post-start counters on read so polled progress reflects the latest
     *  webhook activity even when the worker loop has paused or is between phones. */
    let liveCounters = { ...(doc.counters || {}) };
    if (doc.startedAt) {
      try {
        const post = await manualRecoveryService.computePostStartCounters({
          startedAt: doc.startedAt,
          messageKind: doc.messageKind,
          candidatePhones: doc.candidatePhones || []
        });
        liveCounters = { ...liveCounters, recovered: post.recovered, inFlight: post.inFlight };
      } catch {
        /* fall back to persisted counters */
      }
    }

    const targeted = liveCounters.targeted || (doc.candidatePhones || []).length || 0;
    const completed = (liveCounters.attempted || 0)
      + (liveCounters.skippedAlreadyDelivered || 0)
      + (liveCounters.skippedGlobalRecentSuccess || 0)
      + (liveCounters.skippedInFlightDuplicate || 0);
    const percent = targeted ? Math.min(100, Math.round((completed / targeted) * 100)) : 0;

    return res.json({
      success: true,
      data: {
        _id: doc._id,
        status: doc.status,
        messageKind: doc.messageKind,
        counters: liveCounters,
        progressPercent: percent,
        createdAt: doc.createdAt,
        startedAt: doc.startedAt,
        finishedAt: doc.finishedAt,
        lastProgressAt: doc.lastProgressAt,
        cancelRequested: !!doc.cancelRequested,
        errorSummary: doc.errorSummary || null,
        createdBy: doc.createdBy || null,
        from: doc.fromAt || null,
        to: doc.toAt || null,
        candidatePhonesSample: (doc.candidatePhones || []).slice(0, 10),
        candidatePhonesCount: (doc.candidatePhones || []).length
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.listManualRecoveryJobs = async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 25, 100);
    const filter = {};
    if (req.query.messageKind) filter.messageKind = String(req.query.messageKind).trim();
    if (req.query.status) filter.status = String(req.query.status).trim();
    const rows = await WhatsAppManualRecoveryJob.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({
      success: true,
      data: rows.map((doc) => ({
        _id: doc._id,
        status: doc.status,
        messageKind: doc.messageKind,
        counters: doc.counters || {},
        createdAt: doc.createdAt,
        startedAt: doc.startedAt,
        finishedAt: doc.finishedAt,
        lastProgressAt: doc.lastProgressAt,
        createdBy: doc.createdBy || null,
        candidatePhonesCount: (doc.candidatePhones || []).length
      }))
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

exports.cancelManualRecoveryJob = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const doc = await WhatsAppManualRecoveryJob.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    if (doc.status === 'completed' || doc.status === 'failed' || doc.status === 'cancelled') {
      return res.json({ success: true, data: { _id: doc._id, status: doc.status } });
    }
    doc.cancelRequested = true;
    await doc.save();
    return res.json({ success: true, data: { _id: doc._id, status: doc.status, cancelRequested: true } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * Operational health for the new Health Console.
 * Stable/closed window for charts/tables; today's strip is live-labelled.
 */
exports.getOperationalHealth = async (req, res) => {
  try {
    const messageKind = req.query.messageKind ? String(req.query.messageKind).trim() : null;
    const asOfDateIso = req.query.date ? String(req.query.date).trim().slice(0, 10) : null;
    const windowDays = req.query.windowDays != null ? parseInt(String(req.query.windowDays), 10) : 14;
    const result = await opsAggregates.computeOperationalHealth({
      asOfDateIso,
      windowDays,
      messageKind
    });
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: result.data });
  } catch (e) {
    console.error('[whatsapp-ops getOperationalHealth]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * Paginated unresolved recipients for the Recovery Console.
 * Returns rows + grouped totals so the UI can paint tab counters in one round-trip.
 */
exports.getUnresolvedRecipients = async (req, res) => {
  try {
    const params = req.query || {};
    const messageKind = params.messageKind ? String(params.messageKind).trim() : null;
    const group = params.group ? String(params.group).trim().toLowerCase() : 'all';
    const from = opsAggregates.parseBoundaryDate(params.from, 'start');
    const to = opsAggregates.parseBoundaryDate(params.to, 'end');
    const page = parseInt(String(params.page || '1'), 10) || 1;
    const limit = parseInt(String(params.limit || '50'), 10) || 50;
    const q = params.q != null && String(params.q).trim() ? String(params.q).trim() : null;

    const result = await opsAggregates.computeUnresolvedRecipients({
      from,
      to,
      messageKind,
      group,
      page,
      limit,
      q
    });
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: result.data });
  } catch (e) {
    console.error('[whatsapp-ops getUnresolvedRecipients]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * CSV export grouped by reason for the Recovery Console "Final Unresolved" panel.
 * Streams a single text/csv response; safe for thousands of recipients.
 */
exports.exportUnresolvedCsv = async (req, res) => {
  try {
    const params = req.query || {};
    const messageKind = params.messageKind ? String(params.messageKind).trim() : null;
    const group = params.group ? String(params.group).trim().toLowerCase() : 'all';
    const from = opsAggregates.parseBoundaryDate(params.from, 'start');
    const to = opsAggregates.parseBoundaryDate(params.to, 'end');
    const q = params.q != null && String(params.q).trim() ? String(params.q).trim() : null;

    const result = await opsAggregates.computeUnresolvedRecipients({
      from,
      to,
      messageKind,
      group,
      page: 1,
      limit: 200,
      q
    });
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }

    /** Re-run the aggregation in pages to stream all rows. We bound to 5000 hard. */
    const pages = result.data.totalPages || 1;
    const rows = [...result.data.rows];
    for (let p = 2; p <= pages && rows.length < 5000; p += 1) {
      // eslint-disable-next-line no-await-in-loop
      const next = await opsAggregates.computeUnresolvedRecipients({
        from,
        to,
        messageKind,
        group,
        page: p,
        limit: 200,
        q
      });
      if (next?.data?.rows?.length) rows.push(...next.data.rows);
    }

    /** Sort grouped by exclusionCategory, then reason, then phone for operator copy/paste UX. */
    rows.sort((a, b) => {
      const c = String(a.exclusionCategory || '').localeCompare(String(b.exclusionCategory || ''));
      if (c !== 0) return c;
      const r = String(a.reason || '').localeCompare(String(b.reason || ''));
      if (r !== 0) return r;
      return String(a.phone || '').localeCompare(String(b.phone || ''));
    });

    /** RFC 4180–style fields; quote on comma, quote, CR/LF, tab, or leading formula chars for Excel. */
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v);
      const inner = s.replace(/"/g, '""');
      const trimmed = s.trimStart();
      const mustQuote = /[",\r\n\t]/.test(s) || /^[=+\-@]/.test(trimmed);
      return mustQuote ? `"${inner}"` : inner;
    };
    const header = [
      'exclusion_category',
      'reason',
      'template',
      'phone',
      'name',
      'attempt_stage',
      'lifecycle_state',
      'exclusion_reason',
      'failure_reason',
      'retry_history_count',
      'retry_exhausted',
      'ever_delivered_at',
      'last_attempt_at',
      'retry_group_id',
      'last_event_id'
    ].join(',');
    const lines = rows.map((r) => [
      escape(r.exclusionCategory),
      escape(r.reason),
      escape(r.messageKind),
      escape(r.phone),
      escape(r.name),
      escape(r.attemptStage),
      escape(r.lifecycleState),
      escape(r.exclusionReason),
      escape(r.errorMessage),
      escape(r.retryHistoryCount),
      escape(r.retryExhausted ? 'yes' : 'no'),
      escape(r.everDeliveredAt ? new Date(r.everDeliveredAt).toISOString() : ''),
      escape(r.lastAttemptAt ? new Date(r.lastAttemptAt).toISOString() : ''),
      escape(r.retryGroupId),
      escape(r.lastEventId)
    ].join(','));

    const filename = `unresolved-${messageKind || 'all'}-${group}-${Date.now()}.csv`;
    const csvBody = [header, ...lines].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    return res.send(`\uFEFF${csvBody}`);
  } catch (e) {
    console.error('[whatsapp-ops exportUnresolvedCsv]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};
