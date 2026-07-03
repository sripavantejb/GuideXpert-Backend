'use strict';

function isScopeClassifierEnabled() {
  const explicit = String(process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED ?? '').trim();
  if (explicit === '1') return true;
  if (explicit === '0') return false;
  // Default on when scope firewall is enabled (allow-list-first requires semantic gate for unknowns).
  const { isScopeFirewallEnabled } = require('../scopeFirewall/scopeFirewallFlags');
  return isScopeFirewallEnabled();
}

function isScopeClassifierReady() {
  if (!isScopeClassifierEnabled()) return false;
  const apiKey = String(process.env.LLM_API_KEY || '').trim();
  const baseUrl = String(process.env.LLM_BASE_URL || '').trim();
  const model = String(process.env.LLM_MODEL || '').trim();
  return Boolean(apiKey && baseUrl && model);
}

module.exports = {
  isScopeClassifierEnabled,
  isScopeClassifierReady,
};
