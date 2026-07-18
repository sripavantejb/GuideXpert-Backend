'use strict';

const aggregates = require('../services/conversationRecovery/conversationRecoveryAggregates');
const {
  getPersistedConversationRecoveryConfig,
  setPersistedConversationRecoveryConfig,
} = require('../utils/conversationRecoverySettings');
const {
  pauseCase,
  resumeCase,
  stopCase,
  rescheduleCase,
} = require('../services/conversationRecovery/conversationRecoveryResumeService');
const ConversationRecoveryCase = require('../models/ConversationRecoveryCase');
const ConversationRecoveryAttempt = require('../models/ConversationRecoveryAttempt');
const ConversationRecoverySnapshot = require('../models/ConversationRecoverySnapshot');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const { createHandoff } = require('../services/chatbot/handoffService');
const { getRecoveryHealth } = require('../services/conversationRecovery/conversationRecoveryHealth');
const {
  listAlerts,
  acknowledgeAlert,
  resolveAlert,
  evaluateAndUpsertAlerts,
} = require('../services/conversationRecovery/conversationRecoveryAlertService');
const {
  writeAuditLog,
  listAuditLogs,
  clientIp,
} = require('../services/conversationRecovery/conversationRecoveryAuditService');
const {
  buildDeliveryTimeline,
} = require('../services/conversationRecovery/conversationRecoveryTimeline');
const {
  getCampaignPerformance,
} = require('../services/conversationRecovery/conversationRecoveryCampaignPerformance');
const {
  previewRecoveryMessage,
} = require('../services/conversationRecovery/conversationRecoveryMessageGenerator');
const {
  getSystemMetricsSummary,
  recordSystemMetricSample,
} = require('../services/conversationRecovery/conversationRecoveryMetrics');

function filtersFromQuery(query = {}) {
  return {
    from: query.from || null,
    to: query.to || null,
    exam: query.exam || null,
    phase: query.phase || null,
    deliveryStatus: query.deliveryStatus || null,
    recoveryStatus: query.recoveryStatus || null,
    bookingStatus: query.bookingStatus || null,
    failureReason: query.failureReason || null,
  };
}

function withApiTiming(handler) {
  return async (req, res) => {
    const started = Date.now();
    try {
      await handler(req, res);
    } finally {
      recordSystemMetricSample({
        type: 'api',
        durationMs: Date.now() - started,
        path: req.path,
      });
    }
  };
}

async function auditAction(req, fields) {
  await writeAuditLog({
    admin: req.admin,
    ip: clientIp(req),
    ...fields,
  });
}

exports.getOverview = withApiTiming(async (req, res) => {
  try {
    const data = await aggregates.getOverviewMetrics(filtersFromQuery(req.query));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] overview:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getFunnel = withApiTiming(async (req, res) => {
  try {
    const data = await aggregates.getFunnelMetrics(filtersFromQuery(req.query));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] funnel:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getDaily = withApiTiming(async (req, res) => {
  try {
    const data = await aggregates.getDailyStats(filtersFromQuery(req.query));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] daily:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getTrends = withApiTiming(async (req, res) => {
  try {
    const data = await aggregates.getTrendStats(filtersFromQuery(req.query));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] trends:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getByPhase = withApiTiming(async (req, res) => {
  try {
    const data = await aggregates.getPhaseRecoveryStats(filtersFromQuery(req.query));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] by-phase:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getDeliveryStatus = withApiTiming(async (req, res) => {
  try {
    const data = await aggregates.getDeliveryStatusCounts(filtersFromQuery(req.query));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] delivery-status:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getFailureReasons = withApiTiming(async (req, res) => {
  try {
    const data = await aggregates.getFailureReasons(filtersFromQuery(req.query));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] failure-reasons:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.listStudents = withApiTiming(async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const data = await aggregates.listStudents(filtersFromQuery(req.query), { page, limit });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] students:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getStudentDetail = withApiTiming(async (req, res) => {
  try {
    const data = await aggregates.getStudentDetail(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }
    data.timeline = buildDeliveryTimeline({
      caseDoc: data.case,
      attempts: data.attempts,
      snapshot: data.snapshot,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] student detail:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getStudentTimeline = withApiTiming(async (req, res) => {
  try {
    const data = await aggregates.getStudentDetail(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }
    return res.json({
      success: true,
      data: buildDeliveryTimeline({
        caseDoc: data.case,
        attempts: data.attempts,
        snapshot: data.snapshot,
      }),
    });
  } catch (err) {
    console.error('[conversation-recovery] timeline:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.resend = withApiTiming(async (req, res) => {
  try {
    const before = await ConversationRecoveryCase.findById(req.params.id).lean();
    const scheduledFor = req.body?.scheduledFor
      ? new Date(req.body.scheduledFor)
      : new Date();
    const doc = await rescheduleCase(req.params.id, { scheduledFor });
    if (!doc) {
      return res.status(400).json({ success: false, message: 'Unable to reschedule' });
    }
    await auditAction(req, {
      action: 'retry_recovery',
      targetCaseId: doc._id,
      targetPhone: doc.phone,
      reason: req.body?.reason || null,
      oldValue: before,
      newValue: doc.toObject ? doc.toObject() : doc,
    });
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[conversation-recovery] resend:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.pause = withApiTiming(async (req, res) => {
  try {
    const before = await ConversationRecoveryCase.findById(req.params.id).lean();
    const doc = await pauseCase(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }
    await auditAction(req, {
      action: 'pause_recovery',
      targetCaseId: doc._id,
      targetPhone: doc.phone,
      reason: req.body?.reason || null,
      oldValue: before,
      newValue: doc.toObject ? doc.toObject() : doc,
    });
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[conversation-recovery] pause:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.resume = withApiTiming(async (req, res) => {
  try {
    const before = await ConversationRecoveryCase.findById(req.params.id).lean();
    const doc = await resumeCase(req.params.id);
    if (!doc) {
      return res.status(400).json({ success: false, message: 'Unable to resume' });
    }
    await auditAction(req, {
      action: 'resume_recovery',
      targetCaseId: doc._id,
      targetPhone: doc.phone,
      reason: req.body?.reason || null,
      oldValue: before,
      newValue: doc.toObject ? doc.toObject() : doc,
    });
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[conversation-recovery] resume:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.stop = withApiTiming(async (req, res) => {
  try {
    const before = await ConversationRecoveryCase.findById(req.params.id).lean();
    const doc = await stopCase(req.params.id, req.body?.reason || 'admin_stop');
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }
    await auditAction(req, {
      action: 'stop_recovery',
      targetCaseId: doc._id,
      targetPhone: doc.phone,
      reason: req.body?.reason || 'admin_stop',
      oldValue: before,
      newValue: doc.toObject ? doc.toObject() : doc,
    });
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[conversation-recovery] stop:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.assignHuman = withApiTiming(async (req, res) => {
  try {
    const caseDoc = await ConversationRecoveryCase.findById(req.params.id);
    if (!caseDoc) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }
    const conversation = await WhatsAppConversation.findById(caseDoc.conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    const handoff = await createHandoff({
      conversation,
      leadContext: { phone: caseDoc.phone },
      reason: 'conversation_recovery_assign_human',
      userLastMessage: null,
      createdBy: req.admin?.email || 'admin',
    });
    const before = caseDoc.toObject();
    await ConversationRecoveryCase.updateOne(
      { _id: caseDoc._id },
      {
        $set: {
          assignedHumanAt: new Date(),
          paused: true,
          status: 'paused',
          metadata: {
            ...(caseDoc.metadata && typeof caseDoc.metadata === 'object' ? caseDoc.metadata : {}),
            handoffId: handoff?._id ? String(handoff._id) : null,
          },
        },
      }
    );
    await auditAction(req, {
      action: 'assign_human',
      targetCaseId: caseDoc._id,
      targetPhone: caseDoc.phone,
      reason: req.body?.reason || null,
      oldValue: before,
      newValue: { handoffId: handoff?._id ? String(handoff._id) : null },
    });
    return res.json({
      success: true,
      data: {
        handoffId: handoff?._id ? String(handoff._id) : null,
        conversationId: String(caseDoc.conversationId),
      },
    });
  } catch (err) {
    console.error('[conversation-recovery] assign-human:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.bulkAction = withApiTiming(async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim();
    let ids = Array.isArray(req.body?.caseIds) ? req.body.caseIds : [];
    const reason = req.body?.reason || `bulk_${action}`;

    if (action === 'retry_failed') {
      const failed = await ConversationRecoveryAttempt.find({
        deliveryStatus: 'failed',
      })
        .select('caseId')
        .lean();
      ids = [...new Set(failed.map((f) => String(f.caseId)))];
    }

    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'No cases selected' });
    }

    const results = [];
    for (const id of ids.slice(0, 200)) {
      let doc = null;
      if (action === 'retry' || action === 'retry_failed' || action === 'retry_selected') {
        doc = await rescheduleCase(id, { scheduledFor: new Date() });
      } else if (action === 'pause' || action === 'pause_selected') {
        doc = await pauseCase(id);
      } else if (action === 'resume' || action === 'resume_selected') {
        doc = await resumeCase(id);
      } else if (action === 'stop' || action === 'stop_selected') {
        doc = await stopCase(id, reason);
      } else {
        return res.status(400).json({ success: false, message: `Unknown action: ${action}` });
      }
      results.push({ id, ok: Boolean(doc) });
    }

    await auditAction(req, {
      action: `bulk_${action}`,
      reason,
      metadata: { count: results.length, results },
      oldValue: null,
      newValue: { caseIds: ids.slice(0, 200) },
    });

    return res.json({
      success: true,
      data: {
        action,
        processed: results.length,
        succeeded: results.filter((r) => r.ok).length,
        results,
      },
    });
  } catch (err) {
    console.error('[conversation-recovery] bulk:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getConfig = withApiTiming(async (req, res) => {
  try {
    const data = await getPersistedConversationRecoveryConfig();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] get config:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.putConfig = withApiTiming(async (req, res) => {
  try {
    const before = await getPersistedConversationRecoveryConfig();
    const data = await setPersistedConversationRecoveryConfig(req.body || {});
    await auditAction(req, {
      action: 'update_config',
      reason: req.body?.reason || null,
      oldValue: before,
      newValue: data,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] put config:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getHealth = withApiTiming(async (req, res) => {
  try {
    const data = await getRecoveryHealth();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] health:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getAlerts = withApiTiming(async (req, res) => {
  try {
    if (req.query.refresh === '1') {
      await evaluateAndUpsertAlerts();
    }
    const data = await listAlerts({
      status: req.query.status || 'open',
      limit: Number(req.query.limit) || 50,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] alerts:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.acknowledgeAlert = withApiTiming(async (req, res) => {
  try {
    const data = await acknowledgeAlert(req.params.id);
    await auditAction(req, {
      action: 'acknowledge_alert',
      reason: req.body?.reason || null,
      newValue: { alertId: req.params.id },
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.resolveAlertHandler = withApiTiming(async (req, res) => {
  try {
    const data = await resolveAlert(req.params.id);
    await auditAction(req, {
      action: 'resolve_alert',
      reason: req.body?.reason || null,
      newValue: { alertId: req.params.id },
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getAuditLogs = withApiTiming(async (req, res) => {
  try {
    const data = await listAuditLogs({
      page: Number(req.query.page) || 1,
      limit: Math.min(Number(req.query.limit) || 50, 200),
      action: req.query.action || null,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] audit:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getCampaignPerformance = withApiTiming(async (req, res) => {
  try {
    const data = await getCampaignPerformance();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] campaign:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.previewMessage = withApiTiming(async (req, res) => {
  try {
    let vars = {
      lastPhase: Number(req.body?.lastPhase) || 9,
      studentName: req.body?.studentName || 'Student',
      examName: req.body?.examName || null,
      collegeName: req.body?.collegeName || null,
      counselingService: req.body?.counselingService || null,
    };
    if (req.body?.caseId) {
      const detail = await aggregates.getStudentDetail(req.body.caseId);
      if (detail?.snapshot) {
        const blob = detail.snapshot.journeyBlob || {};
        const profile = blob.profile || {};
        vars = {
          lastPhase: detail.snapshot.lastPhase || vars.lastPhase,
          studentName: detail.snapshot.studentName || profile.studentName || vars.studentName,
          examName: detail.snapshot.examName || profile.examName || null,
          collegeName:
            profile.preferredCollege ||
            profile.bestMatchCollege ||
            profile.collegeName ||
            null,
          counselingService: profile.phase12Service || profile.selectedService || null,
        };
      }
    }
    const data = previewRecoveryMessage(vars);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[conversation-recovery] preview:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

exports.getSystemMetrics = withApiTiming(async (req, res) => {
  try {
    return res.json({ success: true, data: getSystemMetricsSummary() });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
