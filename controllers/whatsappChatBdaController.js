const bdaChat = require('../services/chatbot/bdaChatInboxService');

exports.listHandoffs = async (req, res) => {
  try {
    const items = await bdaChat.listHandoffsForBda(req.bda._id, {
      status: req.query.status,
      limit: parseInt(req.query.limit || '50', 10) || 50,
    });
    return res.json({ success: true, items });
  } catch (e) {
    console.error('[whatsappChatBda] list', e);
    return res.status(500).json({ success: false, message: 'Failed to list handoffs' });
  }
};

exports.replyHandoff = async (req, res) => {
  try {
    const text = req.body && req.body.text ? String(req.body.text).trim() : '';
    if (!text) {
      return res.status(400).json({ success: false, message: 'text is required' });
    }
    const result = await bdaChat.bdaReplyToHandoff(req.params.id, req.bda._id, text);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('[whatsappChatBda] reply', e);
    return res.status(500).json({ success: false, message: 'Reply failed' });
  }
};

exports.resolveHandoff = async (req, res) => {
  try {
    const result = await bdaChat.bdaResolveHandoff(req.params.id, req.bda._id);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true, handoff: result.handoff });
  } catch (e) {
    console.error('[whatsappChatBda] resolve', e);
    return res.status(500).json({ success: false, message: 'Resolve failed' });
  }
};
