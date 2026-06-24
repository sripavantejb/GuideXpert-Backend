'use strict';

const copilot = require('../services/chatbot/humanCopilot/humanCopilotService');
const { generateSuggestedReplies } = require('../services/chatbot/humanCopilot/humanCopilotSuggestService');
const { getCopilotMetrics } = require('../services/chatbot/humanCopilot/humanCopilotMetricsService');
const {
  getAnalyticsOverview,
  getAnalyticsWorkloads,
  getAnalyticsAiUsage,
  getAnalyticsEscalations,
  getAnalyticsDelivery,
  getAnalyticsLeadQuality,
} = require('../services/chatbot/humanCopilot/humanCopilotAnalyticsService');
const {
  getLearningOverview,
  getLearningEditPatterns,
  getLearningTopics,
  getLearningExamples,
} = require('../services/chatbot/humanCopilot/humanCopilotLearningService');
const {
  getRecommendedFollowups,
  getFollowupForHandoff,
  sendFollowup,
  skipFollowup,
} = require('../services/chatbot/humanCopilot/humanCopilotFollowupService');
const {
  listAgents,
  updateAgentStatus,
  updateAgentSettings,
} = require('../services/chatbot/humanCopilot/humanCopilotAgentService');
const {
  getRoutingConfig,
  updateRoutingSettings,
  autoAssignHandoff,
} = require('../services/chatbot/humanCopilot/humanCopilotRoutingService');
const { buildAuditEntry } = require('../services/chatbot/humanCopilot/humanCopilotAuditService');
const { getHumanCopilotConfigStatus } = require('../utils/humanCopilotConfigStatus');
const WhatsAppAgentHandoff = require('../models/WhatsAppAgentHandoff');

function mapConflictStatus(error) {
  if (error === 'already_assigned') return 409;
  if (error === 'version_conflict') return 409;
  return 400;
}

exports.getConfig = async (req, res) => {
  try {
    return res.json({ success: true, config: getHumanCopilotConfigStatus() });
  } catch (e) {
    console.error('[humanCopilot] getConfig', e);
    return res.status(500).json({ success: false, message: 'Failed to load config' });
  }
};

exports.listQueue = async (req, res) => {
  try {
    const items = await copilot.listQueue({
      srCounsellor: req.query.srCounsellor || null,
      agentId: req.query.agentId || null,
      status: req.query.status || null,
      limit: req.query.limit,
    });
    return res.json({ success: true, items });
  } catch (e) {
    console.error('[humanCopilot] listQueue', e);
    return res.status(500).json({ success: false, message: 'Failed to load queue' });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const items = await copilot.getNotifications();
    return res.json({ success: true, items, count: items.length });
  } catch (e) {
    console.error('[humanCopilot] getNotifications', e);
    return res.status(500).json({ success: false, message: 'Failed to load notifications' });
  }
};

exports.getMetrics = async (req, res) => {
  try {
    const metrics = await getCopilotMetrics({ sinceDays: req.query.sinceDays });
    return res.json({ success: true, metrics });
  } catch (e) {
    console.error('[humanCopilot] getMetrics', e);
    return res.status(500).json({ success: false, message: 'Failed to load metrics' });
  }
};

function analyticsHandler(fn) {
  return async (req, res) => {
    try {
      const result = await fn({ sinceDays: req.query.sinceDays });
      return res.json({ success: true, meta: result.meta, data: result.data });
    } catch (e) {
      console.error('[humanCopilot] analytics', e);
      return res.status(500).json({ success: false, message: 'Failed to load analytics' });
    }
  };
}

exports.getAnalyticsOverview = analyticsHandler(getAnalyticsOverview);
exports.getAnalyticsWorkloads = analyticsHandler(getAnalyticsWorkloads);
exports.getAnalyticsAiUsage = analyticsHandler(getAnalyticsAiUsage);
exports.getAnalyticsEscalations = analyticsHandler(getAnalyticsEscalations);
exports.getAnalyticsDelivery = analyticsHandler(getAnalyticsDelivery);
exports.getAnalyticsLeadQuality = analyticsHandler(getAnalyticsLeadQuality);

function learningHandler(fn) {
  return async (req, res) => {
    try {
      const result = await fn({
        sinceDays: req.query.sinceDays,
        limit: req.query.limit,
      });
      return res.json({ success: true, meta: result.meta, data: result.data });
    } catch (e) {
      console.error('[humanCopilot] learning', e);
      return res.status(500).json({ success: false, message: 'Failed to load learning data' });
    }
  };
}

exports.getLearningOverview = learningHandler(getLearningOverview);
exports.getLearningEditPatterns = learningHandler(getLearningEditPatterns);
exports.getLearningTopics = learningHandler(getLearningTopics);
exports.getLearningExamples = learningHandler(getLearningExamples);

exports.getRecommendedFollowups = async (req, res) => {
  try {
    const result = await getRecommendedFollowups({ inactiveDays: req.query.sinceDays });
    return res.json({ success: true, meta: result.meta, data: result.data });
  } catch (e) {
    console.error('[humanCopilot] getRecommendedFollowups', e);
    return res.status(500).json({ success: false, message: 'Failed to load follow-ups' });
  }
};

exports.getFollowupForHandoff = async (req, res) => {
  try {
    const result = await getFollowupForHandoff(req.params.handoffId, {
      inactiveDays: req.query.sinceDays,
    });
    if (result.error === 'not_found') {
      return res.status(404).json({ success: false, message: 'Handoff not found' });
    }
    return res.json({ success: true, meta: result.meta, data: result.data });
  } catch (e) {
    console.error('[humanCopilot] getFollowupForHandoff', e);
    return res.status(500).json({ success: false, message: 'Failed to load follow-up' });
  }
};

exports.sendFollowup = async (req, res) => {
  try {
    const followupId = req.body?.followupId;
    if (!followupId) {
      return res.status(400).json({ success: false, message: 'followupId is required' });
    }
    const result = await sendFollowup(req.params.handoffId, req.admin._id, {
      followupId,
      message: req.body?.message,
      lockVersion: req.body?.lockVersion ?? null,
    });
    if (!result.success) {
      const code =
        result.error === 'not_found' ? 404 : mapConflictStatus(result.error);
      return res.status(code).json({ success: false, message: result.error || 'send_failed', ...result });
    }
    return res.json({ success: true, ...result });
  } catch (e) {
    console.error('[humanCopilot] sendFollowup', e);
    return res.status(500).json({ success: false, message: 'Failed to send follow-up' });
  }
};

exports.skipFollowup = async (req, res) => {
  try {
    const followupId = req.body?.followupId;
    if (!followupId) {
      return res.status(400).json({ success: false, message: 'followupId is required' });
    }
    const result = await skipFollowup(req.params.handoffId, req.admin._id, { followupId });
    if (!result.success) {
      const code = result.error === 'not_found' ? 404 : 400;
      return res.status(code).json({ success: false, message: result.error || 'skip_failed' });
    }
    return res.json({ success: true, skippedAt: result.skippedAt });
  } catch (e) {
    console.error('[humanCopilot] skipFollowup', e);
    return res.status(500).json({ success: false, message: 'Failed to skip follow-up' });
  }
};

exports.getHandoffMessages = async (req, res) => {
  try {
    const data = await copilot.getHandoffMessages(req.params.id, {
      limit: req.query.limit,
      before: req.query.before || null,
      beforeId: req.query.beforeId || null,
      after: req.query.after || null,
      afterId: req.query.afterId || null,
    });
    if (data.error === 'not_found') {
      return res.status(404).json({ success: false, message: 'Handoff not found' });
    }
    if (data.error === 'not_copilot_handoff') {
      return res.status(400).json({ success: false, message: 'Not an admin pool handoff' });
    }
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[humanCopilot] getHandoffMessages', e);
    return res.status(500).json({ success: false, message: 'Failed to load messages' });
  }
};

exports.getHandoffDetail = async (req, res) => {
  try {
    const data = await copilot.getHandoffDetail(req.params.id);
    if (data.error === 'not_found') {
      return res.status(404).json({ success: false, message: 'Handoff not found' });
    }
    if (data.error === 'not_copilot_handoff') {
      return res.status(400).json({ success: false, message: 'Not an admin pool handoff' });
    }
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[humanCopilot] getHandoffDetail', e);
    return res.status(500).json({ success: false, message: 'Failed to load handoff' });
  }
};

exports.releaseHandoff = async (req, res) => {
  try {
    const result = await copilot.releaseHandoff(req.params.id, req.admin._id, {
      lockVersion: req.body?.lockVersion ?? null,
    });
    if (!result.success) {
      const code = result.error === 'not_found' ? 404 : mapConflictStatus(result.error);
      return res.status(code).json({ success: false, message: result.error, ...result });
    }
    return res.json({
      success: true,
      handoff: result.handoff,
      lockVersion: result.lockVersion,
    });
  } catch (e) {
    console.error('[humanCopilot] releaseHandoff', e);
    return res.status(500).json({ success: false, message: 'Failed to release handoff' });
  }
};

exports.reassignHandoff = async (req, res) => {
  try {
    const srCounsellor = req.body?.srCounsellor;
    const agentId = req.body?.agentId;
    const lockVersion = req.body?.lockVersion ?? null;
    const target = agentId ? { agentId } : srCounsellor;
    const result = await copilot.reassignHandoff(req.params.id, target, req.admin._id, { lockVersion });
    if (!result.success) {
      const code = result.error === 'not_found' ? 404 : mapConflictStatus(result.error);
      return res.status(code).json({ success: false, message: result.error, ...result });
    }
    return res.json({
      success: true,
      handoff: result.handoff,
      lockVersion: result.lockVersion,
    });
  } catch (e) {
    console.error('[humanCopilot] reassignHandoff', e);
    return res.status(500).json({ success: false, message: 'Failed to reassign handoff' });
  }
};

exports.assignHandoff = async (req, res) => {
  try {
    const srCounsellor = req.body?.srCounsellor;
    const agentId = req.body?.agentId;
    const lockVersion = req.body?.lockVersion ?? null;
    const force = Boolean(req.body?.force);
    const target = agentId ? { agentId } : srCounsellor;
    const result = await copilot.assignHandoff(
      req.params.id,
      target,
      req.admin._id,
      { lockVersion, force }
    );
    if (!result.success) {
      const code = result.error === 'not_found' ? 404 : mapConflictStatus(result.error);
      return res.status(code).json({
        success: false,
        message: result.error,
        ...result,
      });
    }
    return res.json({
      success: true,
      handoff: result.handoff,
      lockVersion: result.lockVersion,
    });
  } catch (e) {
    console.error('[humanCopilot] assignHandoff', e);
    return res.status(500).json({ success: false, message: 'Failed to assign handoff' });
  }
};

exports.addNote = async (req, res) => {
  try {
    const result = await copilot.addInternalNote(
      req.params.id,
      req.admin._id,
      req.body?.text
    );
    if (!result.success) {
      const code = result.error === 'not_found' ? 404 : 400;
      return res.status(code).json({ success: false, message: result.error });
    }
    return res.json({ success: true, internalNotes: result.internalNotes });
  } catch (e) {
    console.error('[humanCopilot] addNote', e);
    return res.status(500).json({ success: false, message: 'Failed to add note' });
  }
};

exports.suggestReply = async (req, res) => {
  try {
    const handoff = await copilot.getHandoffById(req.params.id);
    if (!handoff || handoff.route !== 'admin_pool') {
      return res.status(404).json({ success: false, message: 'Handoff not found' });
    }
    const result = await generateSuggestedReplies({
      handoff,
      inboundText: req.body?.inboundText,
    });
    if (!result.success) {
      return res.json({
        success: true,
        suggestions: [],
        fallback: true,
        fallbackReason: result.error,
        message: 'AI suggestions unavailable. You can reply manually.',
        contextUsed: result.contextUsed || null,
      });
    }
    if ((result.suggestions || []).length > 0) {
      await WhatsAppAgentHandoff.updateOne(
        { _id: handoff._id },
        {
          $push: {
            auditTrail: buildAuditEntry({
              action: 'suggest_requested',
              adminId: req.admin._id,
              srCounsellor: handoff.assignedSrCounsellor || null,
            }),
          },
        }
      );
    }
    return res.json({
      success: true,
      suggestions: result.suggestions,
      contextUsed: result.contextUsed,
      fallback: false,
    });
  } catch (e) {
    console.error('[humanCopilot] suggestReply', e);
    return res.json({
      success: true,
      suggestions: [],
      fallback: true,
      fallbackReason: 'suggestion_failed',
      message: 'AI suggestions unavailable. You can reply manually.',
    });
  }
};

exports.reply = async (req, res) => {
  try {
    const text = req.body?.text;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, message: 'text is required' });
    }
    const result = await copilot.sendReply(req.params.id, req.admin._id, String(text).trim(), {
      lockVersion: req.body?.lockVersion ?? null,
      suggestedText: req.body?.suggestedText ?? null,
      replySource: req.body?.replySource ?? null,
    });
    if (!result.success) {
      const code =
        result.error === 'not_found' ? 404 : mapConflictStatus(result.error);
      return res.status(code).json({
        success: false,
        message: result.error || 'send_failed',
        deliveryStatus: result.deliveryStatus || 'failed',
        providerStatus: result.providerStatus || result.deliveryStatus || 'failed',
        errorMessage: result.errorMessage || result.message || null,
        replyId: result.replyId || null,
        draftText: result.draftText || String(text).trim(),
        failedReply: result.failedReply || null,
        lockVersion: result.lockVersion ?? null,
      });
    }
    return res.json({
      success: true,
      deliveryStatus: result.deliveryStatus,
      providerStatus: result.providerStatus || result.deliveryStatus,
      outboundMessageId: result.outboundMessageId || null,
      errorMessage: result.errorMessage || null,
      replyId: result.replyId,
      lockVersion: result.lockVersion,
      replySource: result.replySource,
      sessionFallback: Boolean(result.sessionFallback),
    });
  } catch (e) {
    console.error('[humanCopilot] reply', e);
    return res.status(500).json({ success: false, message: 'Failed to send reply' });
  }
};

exports.retryReply = async (req, res) => {
  try {
    const replyId = req.body?.replyId;
    if (!replyId) {
      return res.status(400).json({ success: false, message: 'replyId is required' });
    }
    const result = await copilot.retryReply(req.params.id, req.admin._id, replyId, {
      lockVersion: req.body?.lockVersion ?? null,
    });
    if (!result.success) {
      const code =
        result.error === 'not_found' ? 404 : mapConflictStatus(result.error);
      return res.status(code).json({
        success: false,
        message: result.error || 'retry_failed',
        deliveryStatus: result.deliveryStatus || 'failed',
        replyId: result.replyId || replyId,
        draftText: result.draftText || null,
        lockVersion: result.lockVersion ?? null,
      });
    }
    return res.json({
      success: true,
      deliveryStatus: result.deliveryStatus,
      replyId: result.replyId,
      lockVersion: result.lockVersion,
    });
  } catch (e) {
    console.error('[humanCopilot] retryReply', e);
    return res.status(500).json({ success: false, message: 'Failed to retry reply' });
  }
};

exports.resolve = async (req, res) => {
  try {
    const result = await copilot.resolveHandoffForCopilot(req.params.id, req.admin._id, {
      lockVersion: req.body?.lockVersion ?? null,
    });
    if (!result.success) {
      const code =
        result.error === 'not_found'
          ? 404
          : mapConflictStatus(result.error);
      return res.status(code).json({
        success: false,
        message: result.error || 'resolve_failed',
        lockVersion: result.lockVersion ?? null,
      });
    }
    return res.json({
      success: true,
      handoff: result.handoff,
      lockVersion: result.lockVersion,
    });
  } catch (e) {
    console.error('[humanCopilot] resolve', e);
    return res.status(500).json({ success: false, message: 'Failed to resolve handoff' });
  }
};

exports.listAgents = async (req, res) => {
  try {
    const [agents, routing] = await Promise.all([listAgents(), getRoutingConfig()]);
    return res.json({
      success: true,
      agents,
      routing: {
        mode: routing.routingMode,
        modeLabel: routing.routingModeLabel,
        fallbackRole: routing.fallbackRole,
      },
      analytics: routing.analytics,
    });
  } catch (e) {
    console.error('[humanCopilot] listAgents', e);
    return res.status(500).json({ success: false, message: 'Failed to load agents' });
  }
};

exports.updateAgentStatus = async (req, res) => {
  try {
    const { adminId, availability } = req.body || {};
    if (!adminId || !availability) {
      return res.status(400).json({ success: false, message: 'adminId and availability are required' });
    }
    const result = await updateAgentStatus(adminId, availability);
    if (!result.success) {
      const code = result.error === 'not_found' ? 404 : 400;
      return res.status(code).json({ success: false, message: result.error });
    }
    return res.json({ success: true, agent: result.agent });
  } catch (e) {
    console.error('[humanCopilot] updateAgentStatus', e);
    return res.status(500).json({ success: false, message: 'Failed to update agent status' });
  }
};

exports.updateAgentSettings = async (req, res) => {
  try {
    const { adminId, routingMode, specialtyRules, ...agentSettings } = req.body || {};

    if (routingMode != null || specialtyRules != null) {
      const routingResult = await updateRoutingSettings({ routingMode, specialtyRules });
      if (!routingResult.success) {
        return res.status(400).json({ success: false, message: routingResult.error });
      }
    }

    if (!adminId) {
      const routing = await getRoutingConfig();
      return res.json({ success: true, routing });
    }

    const result = await updateAgentSettings(adminId, agentSettings);
    if (!result.success) {
      const code = result.error === 'not_found' ? 404 : 400;
      return res.status(code).json({ success: false, message: result.error });
    }
    return res.json({ success: true, agent: result.agent });
  } catch (e) {
    console.error('[humanCopilot] updateAgentSettings', e);
    return res.status(500).json({ success: false, message: 'Failed to update agent settings' });
  }
};

exports.getRouting = async (req, res) => {
  try {
    const routing = await getRoutingConfig();
    return res.json({ success: true, data: routing });
  } catch (e) {
    console.error('[humanCopilot] getRouting', e);
    return res.status(500).json({ success: false, message: 'Failed to load routing config' });
  }
};

exports.autoAssignHandoff = async (req, res) => {
  try {
    const result = await autoAssignHandoff(req.params.id);
    if (result.error === 'not_found') {
      return res.status(404).json({ success: false, message: 'Handoff not found' });
    }
    return res.json({
      success: true,
      assigned: Boolean(result.assigned),
      agent: result.agent || null,
      agentId: result.agentId || null,
      routingMode: result.routingMode || null,
      reason: result.reason || null,
      fallback: result.fallback || null,
      handoff: result.handoff || null,
      lockVersion: result.lockVersion ?? null,
    });
  } catch (e) {
    console.error('[humanCopilot] autoAssignHandoff', e);
    return res.status(500).json({ success: false, message: 'Failed to auto-assign handoff' });
  }
};
