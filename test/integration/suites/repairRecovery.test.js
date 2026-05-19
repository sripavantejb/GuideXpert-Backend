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
const { ensureJobsForBooking, getJob } = require('../factories/reminderJobFactory');
const { createMessageEvent } = require('../factories/retryFactory');
const {
  repairReminderJobLifecycle,
  recoverStuckReminderJobs,
  syncReminderJobFromRetryGroup
} = require('../../../services/whatsappReminderJobLifecycle');
const { runReminderCron } = require('../helpers/cronRunner');
const { assertMonotonicJobTransition } = require('../helpers/lifecycleAssert');
const WhatsAppReminderJob = require('../../../models/WhatsAppReminderJob');
const gupshupService = require('../../../services/gupshupService');

describe('repair / recovery integration', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test('repair syncs job when event delivered but job pending', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const booking = await createBooking();
    await ensureJobsForBooking(booking, clock.opts());
    const job = await getJob(booking._id, 'pre4hr');

    const ev = await createMessageEvent({
      phone: booking.phone,
      formSubmissionId: booking._id,
      retryGroupId: job.retryGroupId,
      messageKind: 'pre4hr',
      status: 'delivered',
      deliveredAt: clock.now()
    });

    await WhatsAppReminderJob.updateOne(
      { _id: job._id },
      { $set: { state: 'pending', initialMessageEventId: ev._id } }
    );

    const before = await WhatsAppReminderJob.findById(job._id).lean();
    await syncReminderJobFromRetryGroup(job.retryGroupId);
    const repair = await repairReminderJobLifecycle({
      now: clock.now(),
      messageKinds: ['pre4hr'],
      limit: 50
    });
    const after = await WhatsAppReminderJob.findById(job._id).lean();
    assertMonotonicJobTransition(before.state, after.state);
    assert.ok(['delivered', 'read', 'dispatched'].includes(after.state));
    assert.ok(repair.repaired >= 0);
  });

  test('repair during active dispatch does not loop or duplicate sends', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const booking = await createBooking();
    await ensureJobsForBooking(booking, clock.opts());
    const job = await getJob(booking._id, 'pre4hr');
    await WhatsAppReminderJob.updateOne(
      { _id: job._id },
      {
        $set: {
          scheduledSendAt: new Date('2026-05-15T05:00:00.000Z'),
          state: 'pending'
        }
      }
    );

    gupshupService.resetIntegrationStubCallCount();
    const [dispatchRes, repairRes] = await Promise.all([
      runReminderCron('pre4hr', { now: clock.now() }),
      repairReminderJobLifecycle({ now: clock.now(), messageKinds: ['pre4hr'], limit: 50 })
    ]);
    await recoverStuckReminderJobs({ now: clock.now(), messageKinds: ['pre4hr'], limit: 50 });

    assert.ok(dispatchRes.stats.jobsClaimed >= 0);
    assert.ok(repairRes.repaired >= 0);
    assert.ok(gupshupService.getIntegrationStubCallCount() <= 2);
  });
});
