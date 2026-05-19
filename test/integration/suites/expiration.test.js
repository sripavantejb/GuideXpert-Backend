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
const { runReminderCron } = require('../helpers/cronRunner');
const { expireDueReminderJobs } = require('../../../services/whatsappReminderJobLifecycle');
const WhatsAppReminderJob = require('../../../models/WhatsAppReminderJob');

describe('reminder job expiration', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test('expireDueReminderJobs marks skipped after slot', async () => {
    const clock = resetClock('2026-05-16T12:00:00.000Z');
    const booking = await createBooking({ slotDate: '2026-05-15T11:30:00.000Z' });
    await ensureJobsForBooking(booking, { now: new Date('2026-05-15T05:00:00.000Z') });

    await expireDueReminderJobs({ now: clock.now(), messageKinds: ['pre4hr', 'meet', '30min'] });
    const job = await getJob(booking._id, 'pre4hr');
    assert.equal(job.state, 'skipped');
    assert.equal(job.suppressionReason, 'expired');
  });

  test('expired jobs excluded from dispatch', async () => {
    const clock = resetClock('2026-05-16T12:00:00.000Z');
    const booking = await createBooking({ slotDate: '2026-05-15T11:30:00.000Z' });
    await ensureJobsForBooking(booking, { now: new Date('2026-05-15T05:00:00.000Z') });
    await expireDueReminderJobs({ now: clock.now(), messageKinds: ['pre4hr'] });

    const stats = await runReminderCron('pre4hr', { now: clock.now() });
    assert.equal(stats.stats.jobsDispatched, 0);
    const job = await WhatsAppReminderJob.findOne({
      formSubmissionId: booking._id,
      messageKind: 'pre4hr'
    }).lean();
    assert.equal(job.state, 'skipped');
  });
});
