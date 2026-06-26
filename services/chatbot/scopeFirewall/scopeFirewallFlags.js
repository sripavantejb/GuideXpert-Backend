'use strict';

function isScopeFirewallEnabled() {
  return String(process.env.CHATBOT_SCOPE_FIREWALL_ENABLED || '').trim() === '1';
}

/**
 * Shadow mode: evaluate + log but do not block (LLM may still run). Defaults to
 * enforce when unset; set CHATBOT_SCOPE_FIREWALL_SHADOW_MODE=1 to log-only.
 */
function isScopeFirewallShadowMode() {
  const raw = String(process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE ?? '').trim();
  if (raw === '') return false;
  return raw === '1';
}

module.exports = {
  isScopeFirewallEnabled,
  isScopeFirewallShadowMode,
};
