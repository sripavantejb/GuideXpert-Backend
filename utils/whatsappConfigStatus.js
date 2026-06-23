const { isWhatsAppEnabled, isGupshupConfigured } = require('../services/gupshupService');
const { getGupshupCredentialIssues } = require('./gupshupCredentialValidation');
const {
  getConfiguredWebhookSecret,
  isWebhookAuthEnforced,
  isProductionEnv,
} = require('./gupshupWebhookAuth');

function isChatbotEnabled() {
  return String(process.env.CHATBOT_ENABLED || '1').trim() !== '0';
}

/**
 * Non-secret WhatsApp / chatbot configuration snapshot for health checks and startup logs.
 */
function getWhatsAppConfigStatus() {
  const whatsappEnabled = isWhatsAppEnabled();
  const gupshupConfigured = isGupshupConfigured();
  const webhookSecretConfigured = Boolean(getConfiguredWebhookSecret());
  const chatbotEnabled = isChatbotEnabled();
  const webhookAuthEnforced = isWebhookAuthEnforced();
  const production = isProductionEnv();

  const issues = [];
  if (whatsappEnabled) {
    issues.push(...getGupshupCredentialIssues());
  }
  const authRequiredFlag = String(process.env.GUPSHUP_WEBHOOK_AUTH_REQUIRED || '').trim();
  if (authRequiredFlag === '1' && !webhookSecretConfigured) {
    issues.push('GUPSHUP_WEBHOOK_AUTH_REQUIRED=1 but GUPSHUP_WEBHOOK_SECRET is not set');
  }
  if (chatbotEnabled && whatsappEnabled && !gupshupConfigured) {
    issues.push('Chatbot cannot send session replies without Gupshup API credentials');
  }

  const ready =
    chatbotEnabled &&
    gupshupConfigured &&
    (authRequiredFlag !== '1' || webhookSecretConfigured);

  const warnings = [];
  if (!webhookSecretConfigured && authRequiredFlag !== '1') {
    warnings.push(
      'GUPSHUP_WEBHOOK_SECRET is not set — webhooks are accepted without auth until you add a secret'
    );
  }

  const gupshupSrcName = String(process.env.GUPSHUP_SRC_NAME || '').trim();
  if (gupshupSrcName && /^welcome$/i.test(gupshupSrcName)) {
    warnings.push(
      'GUPSHUP_SRC_NAME is "Welcome" — can cause a stray Welcome label/bubble; unset or rename in Vercel'
    );
  }

  const sessionFallbackEnvKey = String(process.env.CHATBOT_SESSION_FALLBACK_TEMPLATE_ENV || '').trim();
  const sessionFallbackConfigured = Boolean(
    sessionFallbackEnvKey && process.env[sessionFallbackEnvKey]
  );
  if (chatbotEnabled && gupshupConfigured && !sessionFallbackConfigured) {
    warnings.push(
      'CHATBOT_SESSION_FALLBACK_TEMPLATE_ENV not set — users outside the 24h window may only see Gupshup auto-replies when session send fails'
    );
  }

  return {
    whatsappEnabled,
    gupshupConfigured,
    webhookSecretConfigured,
    chatbotEnabled,
    webhookAuthEnforced,
    production,
    ready,
    issues,
    warnings,
    gupshupSrcName: gupshupSrcName || null,
    sessionFallbackConfigured,
  };
}

function logWhatsAppConfigWarnings() {
  const status = getWhatsAppConfigStatus();
  const lines = [...status.issues, ...status.warnings];
  if (lines.length === 0) return;
  console.warn('[env] WhatsApp / chatbot configuration:', lines.join('; '));
  if (status.production && status.issues.some((i) => i.includes('GUPSHUP_WEBHOOK_AUTH_REQUIRED=1'))) {
    console.warn(
      '[env] Production webhooks return 503 until GUPSHUP_WEBHOOK_SECRET is set (or set GUPSHUP_WEBHOOK_AUTH_REQUIRED=0 while Gupshup dev callback has no secret).'
    );
  }
}

module.exports = {
  isChatbotEnabled,
  getWhatsAppConfigStatus,
  logWhatsAppConfigWarnings,
};
