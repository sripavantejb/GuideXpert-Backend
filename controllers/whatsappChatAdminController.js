const chatbotAdmin = require('../services/chatbot/chatbotAdminService');
const { expireStaleHandoffs } = require('../services/chatbot/handoffService');
const { replayPendingInbound } = require('../services/chatbot/whatsappInboundService');

exports.getMetrics = async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : null;
    const metrics = await chatbotAdmin.getMetricsSummary(
      since && !Number.isNaN(since.getTime()) ? since : null
    );
    return res.json({ success: true, metrics });
  } catch (e) {
    console.error('[whatsappChatAdmin] metrics', e);
    return res.status(500).json({ success: false, message: 'Failed to load metrics' });
  }
};

exports.listHandoffs = async (req, res) => {
  try {
    const items = await chatbotAdmin.listHandoffs({
      status: req.query.status,
      route: req.query.route,
      limit: parseInt(req.query.limit || '50', 10) || 50,
    });
    return res.json({ success: true, items });
  } catch (e) {
    console.error('[whatsappChatAdmin] listHandoffs', e);
    return res.status(500).json({ success: false, message: 'Failed to list handoffs' });
  }
};

exports.getTranscript = async (req, res) => {
  try {
    const data = await chatbotAdmin.getConversationTranscript(req.params.conversationId);
    if (!data.conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    return res.json({ success: true, ...data });
  } catch (e) {
    console.error('[whatsappChatAdmin] transcript', e);
    return res.status(500).json({ success: false, message: 'Failed to load transcript' });
  }
};

exports.claimHandoff = async (req, res) => {
  try {
    const result = await chatbotAdmin.claimHandoff(req.params.id, {
      adminId: req.admin._id,
    });
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true, handoff: result.handoff });
  } catch (e) {
    console.error('[whatsappChatAdmin] claim', e);
    return res.status(500).json({ success: false, message: 'Claim failed' });
  }
};

exports.resolveHandoff = async (req, res) => {
  try {
    const result = await chatbotAdmin.resolveHandoff(req.params.id);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true, handoff: result.handoff });
  } catch (e) {
    console.error('[whatsappChatAdmin] resolve', e);
    return res.status(500).json({ success: false, message: 'Resolve failed' });
  }
};

exports.replyHandoff = async (req, res) => {
  try {
    const text = req.body && req.body.text ? String(req.body.text).trim() : '';
    if (!text) {
      return res.status(400).json({ success: false, message: 'text is required' });
    }
    const result = await chatbotAdmin.adminReplyToHandoff(req.params.id, req.admin._id, text);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('[whatsappChatAdmin] reply', e);
    return res.status(500).json({ success: false, message: 'Reply failed' });
  }
};

exports.runMaintenance = async (req, res) => {
  try {
    const [replay, expired] = await Promise.all([
      replayPendingInbound(parseInt(req.query.replayLimit || '30', 10) || 30),
      expireStaleHandoffs(parseInt(req.query.expireLimit || '50', 10) || 50),
    ]);
    return res.json({ success: true, replay, expired });
  } catch (e) {
    console.error('[whatsappChatAdmin] maintenance', e);
    return res.status(500).json({ success: false, message: 'Maintenance failed' });
  }
};
