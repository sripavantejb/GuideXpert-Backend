const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const MessagingCronRun = require('../models/MessagingCronRun');
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
const FormSubmission = require('../models/FormSubmission');
const { buildSlotNotificationVariables } = require('../utils/slotNotificationFormatters');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const gupshupService = require('../services/gupshupService');
const { executeRetryWhatsAppBatch } = require('../services/retryWhatsAppBatch');
const { deriveSubmissionWaStatus } = require('../services/whatsappOpsStatus');

function clampInt(v, dflt, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, 1), max);
}

function dateRange(query) {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : new Date();
  if (from && Number.isNaN(from.getTime())) return { from: null, to };
  if (to && Number.isNaN(to.getTime())) return { from, to: new Date() };
  return { from, to };
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
        { id: 'slot_booked', label: 'Slot booked', description: 'Immediate confirmation after slot booking' },
        { id: 'pre4hr', label: '4hr reminder', description: 'Reminder sent around 4 hours before slot' },
        { id: 'meet', label: 'Meet link (~1hr)', description: 'Meeting link reminder sent around 1 hour before slot' },
        { id: '30min', label: '30 min reminder', description: 'Final reminder sent around 30 minutes before slot' }
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
    if (from) {
      match.createdAt = { $gte: from, $lte: to };
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
            $match: { status: { $in: ['submitted', 'delivered', 'read'] } }
          }, { $count: 'c' }],
          failed: [{
            $match: { status: { $in: ['failed'] } }
          }, { $count: 'c' }],
          delivered: [{
            $match: { status: 'delivered' }
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
    const failedN = msgAgg.failed[0]?.c || 0;
    const deliveredN = msgAgg.delivered[0]?.c || 0;
    const readN = msgAgg.read[0]?.c || 0;
    const retryExN = msgAgg.retryExhausted[0]?.c || 0;
    const retriedN = msgAgg.retried[0]?.c || 0;

    let c = null;
    let webhookN = null;
    if (!messageKind) {
      const cronMatch = from ? { startedAt: { $gte: from, $lte: to } } : {};
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
      webhookN = await WhatsAppWebhookEvent.countDocuments(
        from ? { receivedAt: { $gte: from, $lte: to } } : {}
      );
    }

    const data = {
      totals: {
        whatsappAttempts: total,
        whatsappSuccessApprox: successN,
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
        ...(messageKind ? {} : { cronSuccessRatePct: c.runs ? Math.round((c.ok / c.runs) * 1000) / 10 : null })
      },
      ...(messageKind
        ? {}
        : {
            cronRuns: {
              runs: c.runs,
              success: c.ok,
              failure: c.failed
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
    if (from) base.createdAt = { $gte: from, $lte: to };
    if (req.query.phone) base.phone = String(req.query.phone).replace(/\D/g, '').slice(-10);
    if (req.query.messageKind) base.messageKind = req.query.messageKind;
    if (req.query.status) base.status = req.query.status;
    if (req.query.cronJobKey) base.cronJobKey = req.query.cronJobKey;
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
      return {
        ...e,
        userName: fs?.fullName || fs?.step1Data?.fullName || null,
        slotDate: fs?.step3Data?.slotDate || null,
        slotId: fs?.step3Data?.selectedSlot || null,
        submissionDeliveryStatus: fs?.whatsappDeliveryStatus,
        submissionLastWebhookAt: fs?.whatsappLastWebhookAt,
        derivedStatus: fs ? deriveSubmissionWaStatus(fs) : null,
        whatsappRetryCountSnap: fs?.whatsappRetryCount
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
      status: { $in: ['submitted', 'delivered', 'read'] },
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
