'use strict';

const {
  isScopeFirewallEnabled,
  isScopeFirewallShadowMode,
} = require('../services/chatbot/scopeFirewall/scopeFirewallFlags');

function getScopeFirewallConfigStatus() {
  const enabled = isScopeFirewallEnabled();
  return {
    enabled,
    shadowMode: isScopeFirewallShadowMode(),
    ready: enabled,
  };
}

function logScopeFirewallConfigStatus() {
  const status = getScopeFirewallConfigStatus();
  console.log({
    scopeFirewallEnabled: process.env.CHATBOT_SCOPE_FIREWALL_ENABLED,
    scopeFirewallShadowMode: status.shadowMode,
    scopeFirewallReady: status.ready,
  });
}

module.exports = {
  getScopeFirewallConfigStatus,
  logScopeFirewallConfigStatus,
};
