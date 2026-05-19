'use strict';

const { describe, test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  integrationBefore,
  integrationBeforeEach,
  integrationAfter,
  resetClock,
  getClock
} = require('../harness/setup');
const { createMessageEvent } = require('../factories/retryFactory');
const { replayWebhookOnEvent } = require('../factories/webhookFactory');
const { reconcileStaleInFlightMessages } = require('../../../services/whatsappMessageReconciliation');
const mongoose = require('mongoose');
const { runRetryCron } = require('../helpers/cronRunner');
const { executeRetryAttempt } = require('../../../services/whatsappRetryOrchestrator');
const { createBooking } = require('../factories/bookingFactory');
const {
  assertEventStatus,
  assertNoDuplicateAttempts,
  countEventsByAttempt
} = require('../helpers/lifecycleAssert');
const WhatsAppMessageEvent = require('../../../models/WhatsAppMessageEvent');
const gupshupService = require('../../../services/gupshupService');

describe('late webhook / reconcile integration', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test('FLOW A: awaiting_final_dlr + late delivered → no retry promotion', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const staleAt = new Date(clock.now().getTime() - 3600000);
    const ev = await createMessageEvent({
      status: 'submitted',
      providerAcceptedAt: staleAt,
      createdAt: staleAt,
      updatedAt: staleAt
    });

    await reconcileStaleInFlightMessages({ now: clock.now(), limit: 50 });
    await assertEventStatus(ev._id, 'awaiting_final_dlr');

    await replayWebhookOnEvent(
      await WhatsAppMessageEvent.findById(ev._id).lean(),
      'delivered',
      { receivedAt: clock.now() }
    );
    const after = await WhatsAppMessageEvent.findById(ev._id).lean();
    assert.equal(after.status, 'delivered');
    assert.equal(after.reconcileDerivedFailure, false);
    assert.equal(after.retryEligible, false);

    await runRetryCron({ now: clock.now() });
    const attempts = await countEventsByAttempt(ev.retryGroupId, ev.phone);
    assert.equal(attempts, 1);
    assert.equal(gupshupService.getIntegrationStubCallCount(), 0);
  });

  test('FLOW B: grace expiry → retry promotion → late delivered on attempt-1', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const booking = await createBooking({
      slotDate: new Date(Date.now() + 2 * 60 * 60 * 1000)
    });
    const staleAt = new Date(clock.now().getTime() - 3600000);
    const ev = await createMessageEvent({
      phone: booking.phone,
      formSubmissionId: booking._id,
      status: 'submitted',
      providerAcceptedAt: staleAt,
      createdAt: staleAt,
      updatedAt: staleAt
    });

    await reconcileStaleInFlightMessages({ now: clock.now(), limit: 50 });
    clock.advance(5000);
    await WhatsAppMessageEvent.updateOne(
      { _id: ev._id },
      { $set: { reconcileFinalityUntil: new Date(clock.now().getTime() - 1) } }
    );
    const { finalizeAwaitingReconcile } = require('../../../services/whatsappMessageReconciliation');
    await finalizeAwaitingReconcile({ now: clock.now(), limit: 50 });

    const failed = await WhatsAppMessageEvent.findById(ev._id).lean();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.reconcileDerivedFailure, true);
    await WhatsAppMessageEvent.updateOne(
      { _id: ev._id },
      { $set: { failedAt: new Date(Date.now() - 120_000), updatedAt: new Date() } }
    );

    gupshupService.resetIntegrationStubCallCount();
    const promo = await executeRetryAttempt({
      retryGroupId: ev.retryGroupId,
      nextAttempt: 2,
      source: 'retry_cron',
      cronRunId: new mongoose.Types.ObjectId(),
      cronJobKey: 'retry_whatsapp',
      requireRegistered: true
    });
    assert.ok(!promo.noop, promo.reason || 'promotion noop');
    const attempt2 = await WhatsAppMessageEvent.findOne({
      retryGroupId: ev.retryGroupId,
      phone: ev.phone,
      attemptNumber: 2
    }).lean();
    assert.ok(attempt2, 'attempt 2 promoted');

    await replayWebhookOnEvent(
      await WhatsAppMessageEvent.findById(ev._id).lean(),
      'delivered',
      { receivedAt: clock.now() }
    );
    const attempt1 = await WhatsAppMessageEvent.findById(ev._id).lean();
    assert.equal(attempt1.status, 'delivered');
    await assertNoDuplicateAttempts(ev.retryGroupId, ev.phone);
    assert.ok(gupshupService.getIntegrationStubCallCount() <= 1);
  });

  test('FLOW C: late read after delivered recovery', async () => {
    const clock = getClock();
    const ev = await createMessageEvent({
      status: 'delivered',
      deliveredAt: clock.now(),
      retryEligible: false,
      retryExclusionReason: 'already_delivered_or_read'
    });

    await replayWebhookOnEvent(
      await WhatsAppMessageEvent.findById(ev._id).lean(),
      'read',
      { receivedAt: clock.now() }
    );
    await assertEventStatus(ev._id, 'read');
  });

  test('FLOW D: duplicate webhook replay is monotonic', async () => {
    const clock = getClock();
    const ev = await createMessageEvent({
      status: 'failed',
      reconcileDerivedFailure: true,
      failedAt: clock.now(),
      retryEligible: true
    });

    const doc = await WhatsAppMessageEvent.findById(ev._id).lean();
    await replayWebhookOnEvent(doc, 'delivered', { receivedAt: clock.now() });
    const afterFirst = await WhatsAppMessageEvent.findById(ev._id).lean();
    assert.equal(afterFirst.status, 'delivered');

    const r2 = await replayWebhookOnEvent(afterFirst, 'delivered', { receivedAt: clock.now() });
    assert.equal(r2.modified, false);
    const afterSecond = await WhatsAppMessageEvent.findById(ev._id).lean();
    assert.equal(afterSecond.status, 'delivered');
  });
});
