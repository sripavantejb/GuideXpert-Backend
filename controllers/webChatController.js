'use strict';

const {
  processWebChatMessage,
  resetWebChatSession,
  isWebChatEnabled,
} = require('../services/webChat/webChatService');

async function postWebChatMessage(req, res) {
  try {
    if (!isWebChatEnabled()) {
      return res.status(503).json({
        response: 'Website chat is temporarily unavailable',
        res_status: 'WEB_CHAT_DISABLED',
        http_status_code: 503,
      });
    }
    const body = req.body || {};
    const result = await processWebChatMessage({
      sessionId: body.sessionId,
      message: body.message,
      phone: body.phone,
      fullName: body.fullName,
      isWelcome: Boolean(body.isWelcome),
    });
    return res.status(200).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      response: error.message || 'Could not process chat message',
      res_status: 'WEB_CHAT_FAILED',
      http_status_code: status,
    });
  }
}

async function postWebChatReset(req, res) {
  try {
    const result = await resetWebChatSession(req.body?.sessionId);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      response: error.message || 'Could not reset chat session',
      res_status: 'WEB_CHAT_RESET_FAILED',
      http_status_code: 500,
    });
  }
}

module.exports = { postWebChatMessage, postWebChatReset };
