'use strict';

const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../../../models/WhatsAppMessageEvent');
const WhatsAppRetryGroup = require('../../../models/WhatsAppRetryGroup');

/**
 * @param {object} p
 */
async function createRetryGroup(p = {}) {
  const g = await WhatsAppRetryGroup.create({
    messageKind: p.messageKind || 'pre4hr',
    cronRunId: p.cronRunId || null,
    trigger: p.trigger || 'cron',
    status: p.status || 'open'
  });
  return g.toObject();
}

/**
 * @param {object} p
 */
async function createMessageEvent(p) {
  const retryGroupId = p.retryGroupId || (await createRetryGroup({ messageKind: p.messageKind }))._id;
  const now = p.now || new Date();
  const doc = await WhatsAppMessageEvent.create({
    retryGroupId,
    phone: p.phone || '9000000001',
    formSubmissionId: p.formSubmissionId || null,
    messageKind: p.messageKind || 'pre4hr',
    attemptNumber: p.attemptNumber || 1,
    source: p.source || 'cron',
    status: p.status || 'submitted',
    retryEligible: p.retryEligible != null ? p.retryEligible : true,
    providerAcceptedAt: p.providerAcceptedAt || now,
    createdAt: p.createdAt || now,
    updatedAt: p.updatedAt || now,
    gupshupMessageId: p.gupshupMessageId || `test-gs-${new mongoose.Types.ObjectId()}`,
    reconcileDerivedFailure: p.reconcileDerivedFailure || false,
    reconcilePendingAt: p.reconcilePendingAt || null,
    reconcileFinalityUntil: p.reconcileFinalityUntil || null,
    failedAt: p.failedAt || null,
    deliveredAt: p.deliveredAt || null,
    readAt: p.readAt || null,
    terminalFailureKind: p.terminalFailureKind || null,
    retryExclusionReason: p.retryExclusionReason || null
  });
  return doc.toObject();
}

module.exports = {
  createRetryGroup,
  createMessageEvent
};
