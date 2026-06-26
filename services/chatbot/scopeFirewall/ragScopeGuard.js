'use strict';

const { isIntentAllowed } = require('../../../constants/scopeIntents');
const { resolveScopeFirewallReply } = require('../../../constants/scopeFirewallReplies');

function assertRagAllowed({ scopeResult = {}, knowledgeResults = [], intent = null } = {}) {
  const resolvedIntent = intent || scopeResult.intent || null;

  if (scopeResult.allowed === false && !scopeResult.partialAllowed) {
    return { ok: false, reason: 'intent_blocked' };
  }

  if (resolvedIntent && !isIntentAllowed(resolvedIntent)) {
    return { ok: false, reason: 'intent_blocked' };
  }

  const hits = Array.isArray(knowledgeResults) ? knowledgeResults : [];
  if (!hits.length) {
    return { ok: false, reason: 'no_grounding' };
  }

  return { ok: true, reason: null };
}

function refusalForRagBlock(_reason, resolvedLanguage = 'en') {
  return resolveScopeFirewallReply(resolvedLanguage);
}

module.exports = {
  assertRagAllowed,
  refusalForRagBlock,
};
