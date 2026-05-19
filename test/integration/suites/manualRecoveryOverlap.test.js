'use strict';

const { describe, test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  integrationBefore,
  integrationBeforeEach,
  integrationAfter,
  resetClock
} = require('../harness/setup');
const { createMessageEvent } = require('../factories/retryFactory');
const { buildPreview, isStillUnresolved } = require('../../../services/whatsappManualRecovery');
const { reconcileStaleInFlightMessages } = require('../../../services/whatsappMessageReconciliation');
const { runRetryCron } = require('../helpers/cronRunner');
const { isManualRecoveryBlocked } = require('../../../utils/whatsappRetryRules');
const gupshupService = require('../../../services/gupshupService');

describe('manual recovery overlap', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test('reconcile grace blocks manual recovery preview targets', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const staleAt = new Date(clock.now().getTime() - 5000);
    const ev = await createMessageEvent({
      status: 'submitted',
      providerAcceptedAt: staleAt,
      createdAt: staleAt,
      messageKind: 'pre4hr'
    });

    await reconcileStaleInFlightMessages({ now: clock.now(), limit: 50 });
    const preview = await buildPreview({
      messageKind: 'pre4hr',
      fromAt: new Date('2026-05-14T00:00:00.000Z'),
      toAt: new Date('2026-05-16T00:00:00.000Z')
    });
    assert.ok(preview.data);
    const hit = preview.data.candidates.find((c) => c.phone === ev.phone);
    assert.equal(hit, undefined);
    assert.ok(preview.data.skippedReconcilePending >= 0 || preview.data.skippedAwaitingFinalDlr >= 0);
  });

  test('isStillUnresolved blocks during reconcile grace', async () => {
    const clock = getClockFromReset();
    const finalityUntil = new Date(clock.now().getTime() + 60000);
    const ev = await createMessageEvent({
      status: 'awaiting_final_dlr',
      reconcilePendingAt: clock.now(),
      reconcileFinalityUntil: finalityUntil,
      messageKind: 'pre4hr'
    });

    const blocked = isManualRecoveryBlocked(
      {
        status: 'awaiting_final_dlr',
        reconcileFinalityUntil: finalityUntil
      },
      clock.now()
    );
    assert.equal(blocked, true);

    const check = await isStillUnresolved('pre4hr', ev.phone, ev.createdAt);
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'reconcile_grace_active');
  });

  test('retry cron + manual preview: no duplicate send path for grace row', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const staleAt = new Date(clock.now().getTime() - 5000);
    await createMessageEvent({
      status: 'submitted',
      providerAcceptedAt: staleAt,
      createdAt: staleAt
    });

    await reconcileStaleInFlightMessages({ now: clock.now(), limit: 50 });
    gupshupService.resetIntegrationStubCallCount();
    await runRetryCron({ now: clock.now() });
    const preview = await buildPreview({ messageKind: 'pre4hr' });
    assert.equal(preview.data.targeted, 0);
    assert.equal(gupshupService.getIntegrationStubCallCount(), 0);
  });
});

function getClockFromReset() {
  return resetClock('2026-05-15T06:00:00.000Z');
}
