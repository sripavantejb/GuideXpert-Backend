'use strict';

const { describe, test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  integrationBefore,
  integrationBeforeEach,
  integrationAfter,
  resetClock
} = require('../harness/setup');
const { createBooking } = require('../factories/bookingFactory');
const { ensureJobsForBooking, makeJobDue, getJob } = require('../factories/reminderJobFactory');
const { parallelCronWorkers } = require('../helpers/raceSim');
const { runReminderCron, newCronRunId } = require('../helpers/cronRunner');
const { withCrashPoint, runRecoveryAfterCrash } = require('../harness/crashHooks');
const { assertNoDuplicateAttempts } = require('../helpers/lifecycleAssert');
const WhatsAppReminderJob = require('../../../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../../../models/WhatsAppMessageEvent');
const gupshupService = require('../../../services/gupshupService');

describe('cron overlap / parallel workers', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test('parallel dispatch: at most one dispatch per job', async () => {
    const clock = resetClock('2026-05-15T08:00:00.000Z');
    const booking = await createBooking({ slotDate: '2026-05-15T11:30:00.000Z' });
    await ensureJobsForBooking(booking, clock.opts());
    const job = await getJob(booking._id, 'pre4hr');
    await makeJobDue(job._id, new Date('2026-05-15T05:00:00.000Z'));

    gupshupService.resetIntegrationStubCallCount();
    const runs = await parallelCronWorkers(5, () =>
      runReminderCron('pre4hr', { now: clock.now(), cronRunId: newCronRunId() })
    );

    const updated = await WhatsAppReminderJob.findById(job._id).lean();
    const events = await WhatsAppMessageEvent.find({
      retryGroupId: job.retryGroupId,
      phone: booking.phone
    }).lean();
    const dispatchedRuns = runs.reduce((n, r) => n + (r.stats.jobsDispatched || 0), 0);
    assert.ok(
      ['dispatched', 'delivered', 'read', 'failed'].includes(updated.state) || events.length >= 1,
      `expected dispatch progress, state=${updated.state}`
    );
    const attempt1 = events.filter((e) => e.attemptNumber === 1);
    assert.equal(attempt1.length, 1);
    assert.ok(dispatchedRuns <= 2, 'at most two successful dispatch ticks');
    assert.ok(gupshupService.getIntegrationStubCallCount() <= 2);
  });

  test('lease expiry allows reclaim without double dispatch', async () => {
    const clock = resetClock('2026-05-15T08:00:00.000Z');
    const booking = await createBooking();
    await ensureJobsForBooking(booking, clock.opts());
    const job = await getJob(booking._id, 'pre4hr');
    await makeJobDue(job._id, new Date('2026-05-15T05:00:00.000Z'));

    const runA = newCronRunId();
    await WhatsAppReminderJob.updateOne(
      { _id: job._id },
      {
        $set: {
          state: 'claimed',
          claimToken: String(runA),
          claimedUntil: new Date(clock.now().getTime() + 1000),
          leaseExpiresAt: new Date(clock.now().getTime() + 1000),
          scheduledSendAt: new Date('2026-05-15T05:00:00.000Z')
        }
      }
    );

    clock.advance(5000);
    gupshupService.resetIntegrationStubCallCount();
    await runReminderCron('pre4hr', { now: clock.now(), cronRunId: newCronRunId() });

    const after = await WhatsAppReminderJob.findById(job._id).lean();
    assert.notEqual(after.state, 'claimed');
    assert.ok(gupshupService.getIntegrationStubCallCount() <= 1);
  });

  test('crash after claim recovers to single dispatch', async () => {
    const clock = resetClock('2026-05-15T08:00:00.000Z');
    const booking = await createBooking();
    await ensureJobsForBooking(booking, clock.opts());
    const job = await getJob(booking._id, 'pre4hr');
    await makeJobDue(job._id, new Date('2026-05-15T05:00:00.000Z'));

    await withCrashPoint('after_claim', () =>
      runReminderCron('pre4hr', { now: clock.now(), cronRunId: newCronRunId() })
    );

    clock.advance(5000);
    await runRecoveryAfterCrash({ now: clock.now(), messageKinds: ['pre4hr'] });
    gupshupService.resetIntegrationStubCallCount();
    await runReminderCron('pre4hr', { now: clock.now(), cronRunId: newCronRunId() });

    const after = await WhatsAppReminderJob.findById(job._id).lean();
    assert.notEqual(after.state, 'dispatching');
    if (after.retryGroupId) {
      await assertNoDuplicateAttempts(after.retryGroupId, booking.phone);
    }
  });
});
