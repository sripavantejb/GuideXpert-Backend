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
  const shadowMode = isScopeFirewallShadowMode();
  const classifierEnabled = isScopeClassifierEnabled();
  const enforceMode = enabled && !shadowMode;
  return {
    enabled,
    shadowMode,
    enforceMode,
    ready: enabled,
    productionReady: enabled && enforceMode,
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
    scopeFirewallEnforceMode: status.enforceMode,
    scopeFirewallReady: status.ready,
    scopeFirewallProductionReady: status.productionReady,
    scopeClassifierEnabled: process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED,
    scopeClassifierReady: status.scopeClassifier.ready,
  });
}

module.exports = {
  getScopeFirewallConfigStatus,
  logScopeFirewallConfigStatus,
};
