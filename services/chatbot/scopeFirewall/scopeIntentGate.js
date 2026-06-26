'use strict';

const { evaluateScopeWithClassifier } = require('../scopeFirewallHybrid/scopeClassifierService');
const { enrichScopeWithIntent } = require('../../../constants/scopeIntents');
const { isScopeFirewallEnabled } = require('./scopeFirewallFlags');

function buildScopeLogFields(scope, extras = {}) {
  return {
    scopeIntent: scope.intent || null,
    scopeCategory: scope.category || null,
    scopeAllowed: Boolean(scope.allowed || scope.partialAllowed),
    scopeBlocked: Boolean(scope.blocked),
    scopeReason: scope.reason || null,
    scopeConfidence: scope.confidence ?? scope.classifierResult?.confidence ?? null,
    scopePartial: Boolean(scope.partialAllowed),
    scopeClassifierUsed: Boolean(scope.classifierUsed),
    ...extras,
  };
}

/**
 * Single inbound scope evaluation: rules + optional classifier + intent mapping.
 */
async function evaluateInboundScope(params = {}) {
  if (!isScopeFirewallEnabled()) {
    return enrichScopeWithIntent({
      allowed: true,
      category: 'guidexpert_services',
      reason: 'firewall_disabled',
      intent: 'GUIDEXPERT',
      confidence: 1,
    });
  }

  const scope = await evaluateScopeWithClassifier(params);
  return enrichScopeWithIntent(scope);
}

module.exports = {
  evaluateInboundScope,
  buildScopeLogFields,
};
