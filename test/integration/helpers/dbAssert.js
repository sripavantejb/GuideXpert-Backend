'use strict';

const assert = require('node:assert/strict');
const WhatsAppMessageEvent = require('../../../models/WhatsAppMessageEvent');
const WhatsAppReminderJob = require('../../../models/WhatsAppReminderJob');

async function assertNoOrphanEvents() {
  const orphans = await WhatsAppMessageEvent.countDocuments({
    retryGroupId: null,
    messageKind: { $in: ['pre4hr', 'meet', '30min'] }
  });
  assert.equal(orphans, 0, 'orphan events without retryGroupId');
}

async function assertOneJobPerKind(formSubmissionId) {
  for (const kind of ['pre4hr', 'meet', '30min']) {
    const n = await WhatsAppReminderJob.countDocuments({ formSubmissionId, messageKind: kind });
    assert.equal(n, 1, `expected one job for ${kind}`);
  }
}

async function assertUniqueJobIndex(formSubmissionId, messageKind) {
  const n = await WhatsAppReminderJob.countDocuments({ formSubmissionId, messageKind });
  assert.ok(n <= 1, `unique job violation ${messageKind}`);
}

module.exports = {
  assertNoOrphanEvents,
  assertOneJobPerKind,
  assertUniqueJobIndex
};
