'use strict';

const {
  isScopeFirewallEnabled,
  isScopeFirewallShadowMode,
} = require('../services/chatbot/scopeFirewall/scopeFirewallFlags');
const {
  isScopeClassifierEnabled,
  isScopeClassifierReady,
} = require('../services/chatbot/scopeFirewallHybrid/scopeClassifierFlags');

function getScopeFirewallConfigStatus() {
  const enabled = isScopeFirewallEnabled();
  const classifierEnabled = isScopeClassifierEnabled();
  return {
    enabled,
    shadowMode: isScopeFirewallShadowMode(),
    ready: enabled,
    scopeClassifier: {
      enabled: classifierEnabled,
      ready: classifierEnabled ? isScopeClassifierReady() : false,
    },
  };
}

function logScopeFirewallConfigStatus() {
  const status = getScopeFirewallConfigStatus();
  console.log({
    scopeFirewallEnabled: process.env.CHATBOT_SCOPE_FIREWALL_ENABLED,
    scopeFirewallShadowMode: status.shadowMode,
    scopeFirewallReady: status.ready,
    scopeClassifierEnabled: process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED,
    scopeClassifierReady: status.scopeClassifier.ready,
  });
}

module.exports = {
  getScopeFirewallConfigStatus,
  logScopeFirewallConfigStatus,
};
