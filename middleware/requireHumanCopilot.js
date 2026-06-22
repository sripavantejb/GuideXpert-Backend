'use strict';

const { isHumanCopilotEnabled } = require('../services/chatbot/humanCopilot/humanCopilotFlags');

function requireHumanCopilot(req, res, next) {
  if (!isHumanCopilotEnabled()) {
    return res.status(503).json({
      success: false,
      message: 'Human Copilot is disabled. Set CHATBOT_HUMAN_COPILOT_ENABLED=1.',
    });
  }
  return next();
}

module.exports = { requireHumanCopilot };
