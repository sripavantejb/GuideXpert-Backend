/**
 * Phase 2: when session message fails (user inactive), optional template fallback.
 */
const { sendTemplateMessage } = require('../gupshupService');

async function sendSessionInactiveTemplateFallback(phone10) {
  const envKey = process.env.CHATBOT_SESSION_FALLBACK_TEMPLATE_ENV;
  if (!envKey || !process.env[envKey]) {
    return { success: false, error: 'no_fallback_template' };
  }
  const templateId = process.env[envKey];
  const params = [];
  const nameKey = process.env.CHATBOT_SESSION_FALLBACK_PARAM_NAME;
  if (nameKey) params.push(nameKey);
  return sendTemplateMessage(phone10, templateId, params, {
    templateEnvKey: envKey,
  });
}

module.exports = { sendSessionInactiveTemplateFallback };
