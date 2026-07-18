'use strict';

/**
 * Idempotency helpers for Conversation Recovery sends.
 * Does not change eligibility or counseling logic.
 */

const CAMPAIGN = 'conversation_recovery';

function buildIdempotencyKey(conversationId, attemptNumber, campaign = CAMPAIGN) {
  const cid = conversationId != null ? String(conversationId) : '';
  const n = Number(attemptNumber) || 0;
  return `${cid}:${campaign}:${n}`;
}

function isAttemptAlreadyProcessed(attempt) {
  if (!attempt) return false;
  if (attempt.sentAt) return true;
  if (attempt.gupshupMessageId) return true;
  const status = String(attempt.deliveryStatus || '');
  return ['sent', 'delivered', 'read'].includes(status);
}

module.exports = {
  CAMPAIGN,
  buildIdempotencyKey,
  isAttemptAlreadyProcessed,
};
