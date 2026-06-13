'use strict';

function isScopeFirewallEnabled() {
  return String(process.env.CHATBOT_SCOPE_FIREWALL_ENABLED || '').trim() === '1';
}

/**
 * Shadow mode: evaluate + log but never block. Defaults to true (safe) when the
 * flag is unset so an accidental enablement cannot start blocking traffic.
 */
function isScopeFirewallShadowMode() {
  const raw = String(process.env.CHATBOT_SCOPE_FIREWALL_SHADOW_MODE ?? '').trim();
  if (raw === '') return true;
  return raw !== '0';
}

module.exports = {
  isScopeFirewallEnabled,
  isScopeFirewallShadowMode,
};
