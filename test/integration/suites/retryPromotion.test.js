'use strict';

const { describe, test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  integrationBefore,
  integrationBeforeEach,
  integrationAfter,
  resetClock
} = require('../harness/setup');
const { createBooking } = require('../factories/bookingFactory');
const { createMessageEvent, createRetryGroup } = require('../factories/retryFactory');
const mongoose = require('mongoose');
const { runRetryCron } = require('../helpers/cronRunner');
const { executeRetryAttempt } = require('../../../services/whatsappRetryOrchestrator');
const { reconcileStaleInFlightMessages } = require('../../../services/whatsappMessageReconciliation');
const { rowEligibleAtMs } = require('../../../services/whatsappRetryOrchestrator');
const WhatsAppMessageEvent = require('../../../models/WhatsAppMessageEvent');
const WhatsAppRetryGroup = require('../../../models/WhatsAppRetryGroup');
const gupshupService = require('../../../services/gupshupService');

describe('retry promotion integration', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test('transient failure promotes after delay anchor', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const failedAt = new Date(Date.now() - 120_000);
    const booking = await createBooking({
      slotDate: new Date(Date.now() + 2 * 60 * 60 * 1000)
    });
    const group = await createRetryGroup({ messageKind: 'pre4hr' });
    await createMessageEvent({
      retryGroupId: group._id,
      phone: booking.phone,
      formSubmissionId: booking._id,
      status: 'failed',
      failedAt,
      retryEligible: true,
      terminalFailureKind: 'transient',
      errorMessage: 'temporary delivery failure'
    });

    const ex = await executeRetryAttempt({
      retryGroupId: group._id,
      nextAttempt: 2,
      source: 'retry_cron',
      cronRunId: new mongoose.Types.ObjectId(),
      cronJobKey: 'retry_whatsapp',
      requireRegistered: true
    });
    assert.ok(!ex.noop, ex.reason || 'noop');
    const a2 = await WhatsAppMessageEvent.findOne({
      retryGroupId: group._id,
      attemptNumber: 2
    }).lean();
    assert.ok(a2);
    assert.ok(gupshupService.getIntegrationStubCallCount() >= 1);
  });

  test('awaiting_final_dlr never promotable during reconcile grace', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const staleAt = new Date(clock.now().getTime() - 3600000);
    const ev = await createMessageEvent({
      status: 'submitted',
      providerAcceptedAt: staleAt,
      createdAt: staleAt
    });

    await reconcileStaleInFlightMessages({ now: clock.now(), limit: 50 });
    const row = await WhatsAppMessageEvent.findById(ev._id).lean();
    assert.equal(row.status, 'awaiting_final_dlr');
    assert.equal(rowEligibleAtMs('pre4hr', 1, row), Number.POSITIVE_INFINITY);

    await runRetryCron({ now: clock.now() });
    const a2 = await WhatsAppMessageEvent.countDocuments({
      retryGroupId: ev.retryGroupId,
      attemptNumber: 2
    });
    assert.equal(a2, 0);
  });

  test('retry wall closes group', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const booking = await createBooking();
    const group = await createRetryGroup({ messageKind: 'pre4hr' });
    await WhatsAppRetryGroup.collection.updateOne(
      { _id: group._id },
      { $set: { createdAt: new Date(clock.now().getTime() - 120000) } }
    );

    const failAt = new Date(clock.now().getTime() - 90000);
    await createMessageEvent({
      retryGroupId: group._id,
      phone: booking.phone,
      formSubmissionId: booking._id,
      status: 'failed',
      failedAt: failAt,
      retryEligible: false,
      terminalFailureKind: 'permanent',
      attemptNumber: 1
    });
    await createMessageEvent({
      retryGroupId: group._id,
      phone: booking.phone,
      formSubmissionId: booking._id,
      status: 'failed',
      failedAt: failAt,
      retryEligible: false,
      terminalFailureKind: 'permanent',
      attemptNumber: 2
    });

    const ex = await executeRetryAttempt({
      retryGroupId: group._id,
      nextAttempt: 2,
      source: 'retry_cron',
      cronRunId: new mongoose.Types.ObjectId(),
      cronJobKey: 'retry_whatsapp',
      requireRegistered: true
    });
    assert.equal(ex.noop, true);
    const g = await WhatsAppRetryGroup.findById(group._id).lean();
    assert.ok(
      ['closed_no_more_retries', 'exhausted'].includes(g.status),
      `expected settled group, got ${g.status}`
    );
  });

  test('provider outage does not unbounded promote', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const group = await createRetryGroup({ messageKind: 'pre4hr' });
    await createMessageEvent({
      retryGroupId: group._id,
      status: 'failed',
      failedAt: clock.now(),
      retryEligible: true
    });

    gupshupService.setIntegrationStubFailNext(true);
    await runRetryCron({ now: clock.now() });
    const count = await WhatsAppMessageEvent.countDocuments({ retryGroupId: group._id });
    assert.ok(count <= 3);
  });
});
