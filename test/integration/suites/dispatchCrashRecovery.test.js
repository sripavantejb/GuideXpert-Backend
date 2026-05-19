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
const { ensureJobsForBooking, makeJobDue, getJob } = require('../factories/reminderJobFactory');
const { runReminderCron, newCronRunId } = require('../helpers/cronRunner');
const { withCrashPoint, runRecoveryAfterCrash } = require('../harness/crashHooks');
const WhatsAppReminderJob = require('../../../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../../../models/WhatsAppMessageEvent');
const gupshupService = require('../../../services/gupshupService');

describe('dispatch crash recovery', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  async function seedDueJob() {
    const clock = resetClock('2026-05-15T08:00:00.000Z');
    const booking = await createBooking();
    await ensureJobsForBooking(booking, clock.opts());
    const job = await getJob(booking._id, 'pre4hr');
    await makeJobDue(job._id, new Date('2026-05-15T05:00:00.000Z'));
    return { clock, booking, job };
  }

  test('crash after claim: not stuck dispatching forever', async () => {
    const { clock, job } = await seedDueJob();
    await withCrashPoint('after_claim', () =>
      runReminderCron('pre4hr', { now: clock.now(), cronRunId: newCronRunId() })
    );
    clock.advance(5000);
    await runRecoveryAfterCrash({ now: clock.now() });
    const j = await WhatsAppReminderJob.findById(job._id).lean();
    assert.notEqual(j.state, 'dispatching');
  });

  test('crash after provider accept: bounded provider calls on reclaim', async () => {
    const { clock, job, booking } = await seedDueJob();
    await withCrashPoint('after_provider_accept', () =>
      runReminderCron('pre4hr', { now: clock.now(), cronRunId: newCronRunId() })
    );
    clock.advance(5000);
    await runRecoveryAfterCrash({ now: clock.now() });
    gupshupService.resetIntegrationStubCallCount();
    await runReminderCron('pre4hr', { now: clock.now(), cronRunId: newCronRunId() });
    assert.ok(gupshupService.getIntegrationStubCallCount() <= 2);
    const events = await WhatsAppMessageEvent.countDocuments({
      retryGroupId: job.retryGroupId,
      phone: booking.phone
    });
    assert.ok(events <= 2);
  });

  test('crash after db write: job/event consistent', async () => {
    const { clock, job } = await seedDueJob();
    await withCrashPoint('after_db_write', () =>
      runReminderCron('pre4hr', { now: clock.now(), cronRunId: newCronRunId() })
    );
    const j = await WhatsAppReminderJob.findById(job._id).lean();
    const ev = await WhatsAppMessageEvent.findOne({
      retryGroupId: job.retryGroupId,
      attemptNumber: 1
    }).lean();
    assert.ok(ev);
    assert.ok(['dispatched', 'delivered', 'read', 'failed', 'pending', 'claimed'].includes(j.state));
  });
});
