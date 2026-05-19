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
const { ensureJobsForBooking } = require('../factories/reminderJobFactory');
const { runReminderCron } = require('../helpers/cronRunner');
const WhatsAppReminderJob = require('../../../models/WhatsAppReminderJob');

const STRESS_ENABLED = String(process.env.WA_INTEGRATION_STRESS || '').trim() === '1';
const JOB_COUNT = parseInt(process.env.WA_STRESS_JOB_COUNT || '500', 10) || 500;

describe('high-stress queue fairness', { skip: !STRESS_ENABLED }, () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test(`backlog catch-up dispatches ${JOB_COUNT} jobs without deadlock`, async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const dueAt = new Date('2026-05-15T05:00:00.000Z');

    for (let i = 0; i < JOB_COUNT; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const booking = await createBooking({
        slotDate: '2026-05-15T11:30:00.000Z'
      });
      // eslint-disable-next-line no-await-in-loop
      await ensureJobsForBooking(booking, clock.opts());
      // eslint-disable-next-line no-await-in-loop
      await WhatsAppReminderJob.updateOne(
        { formSubmissionId: booking._id, messageKind: 'pre4hr' },
        { $set: { scheduledSendAt: dueAt, state: 'pending' } }
      );
    }

    const pendingBefore = await WhatsAppReminderJob.countDocuments({
      messageKind: 'pre4hr',
      state: 'pending',
      scheduledSendAt: { $lte: clock.now() }
    });
    assert.equal(pendingBefore, JOB_COUNT);

    let dispatched = 0;
    let passes = 0;
    const maxPasses = Math.ceil(JOB_COUNT / 40) + 5;
    while (dispatched < JOB_COUNT * 0.9 && passes < maxPasses) {
      // eslint-disable-next-line no-await-in-loop
      const stats = await runReminderCron('pre4hr', {
        now: clock.now(),
        limit: 40
      });
      dispatched += stats.stats.jobsDispatched || 0;
      passes += 1;
    }

    const pendingAfter = await WhatsAppReminderJob.countDocuments({
      messageKind: 'pre4hr',
      state: 'pending'
    });
    assert.ok(dispatched > 0, 'some jobs dispatched');
    assert.ok(pendingAfter < pendingBefore, 'backlog drained');
    assert.ok(passes < maxPasses, 'completed without infinite loop');
  });
});
