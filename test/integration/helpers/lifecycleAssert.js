'use strict';

const assert = require('node:assert/strict');
const WhatsAppMessageEvent = require('../../../models/WhatsAppMessageEvent');
const WhatsAppReminderJob = require('../../../models/WhatsAppReminderJob');
const { stateRank } = require('../../../services/whatsappReminderJobLifecycle');

async function assertNoDuplicateAttempts(retryGroupId, phone) {
  const rows = await WhatsAppMessageEvent.find({ retryGroupId, phone }).lean();
  const seen = new Set();
  for (const r of rows) {
    const k = `${r.retryGroupId}:${r.phone}:${r.attemptNumber}`;
    assert.ok(!seen.has(k), `duplicate attempt ${k}`);
    seen.add(k);
  }
  return rows;
}

async function assertJobState(formSubmissionId, messageKind, expectedState) {
  const job = await WhatsAppReminderJob.findOne({ formSubmissionId, messageKind }).lean();
  assert.ok(job, `job missing ${messageKind}`);
  assert.equal(job.state, expectedState, `job ${messageKind} state`);
  return job;
}

async function assertEventStatus(eventId, expectedStatus) {
  const ev = await WhatsAppMessageEvent.findById(eventId).lean();
  assert.ok(ev, 'event missing');
  assert.equal(String(ev.status).toLowerCase(), expectedStatus.toLowerCase());
  return ev;
}

function assertMonotonicJobTransition(fromState, toState) {
  assert.ok(
    stateRank(toState) >= stateRank(fromState),
    `non-monotonic job ${fromState} -> ${toState}`
  );
}

async function countEventsByAttempt(retryGroupId, phone) {
  return WhatsAppMessageEvent.countDocuments({ retryGroupId, phone });
}

module.exports = {
  assertNoDuplicateAttempts,
  assertJobState,
  assertEventStatus,
  assertMonotonicJobTransition,
  countEventsByAttempt
};
