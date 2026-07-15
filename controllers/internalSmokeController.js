'use strict';

const {
  runProductionConversationSmokeSend,
} = require('../services/smoke/productionConversationSmokeService');

/**
 * POST /api/internal/smoke/send
 * Body: { phone, message, resetState?, caseId? }
 */
async function sendSmokeMessage(req, res) {
  try {
    const result = await runProductionConversationSmokeSend({
      phone: req.body?.phone || req.body?.mobile,
      message: req.body?.message ?? req.body?.text ?? req.body?.user,
      resetState: req.body?.resetState,
      caseId: req.body?.caseId || req.body?.id || null,
    });

    const status = result.success ? 200 : 502;
    return res.status(status).json({
      success: result.success,
      data: result,
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) {
      console.error('[internal-smoke] send failed', err.message || err);
    }
    return res.status(code).json({
      success: false,
      message: err.message || 'Smoke send failed',
    });
  }
}

module.exports = {
  sendSmokeMessage,
};
