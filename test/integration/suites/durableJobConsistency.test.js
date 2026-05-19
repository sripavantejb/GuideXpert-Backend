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
const { assertOneJobPerKind, assertNoOrphanEvents } = require('../helpers/dbAssert');
const { parallelRuns } = require('../helpers/raceSim');
const { upsertReminderJob } = require('../../../services/whatsappReminderScheduler');
const WhatsAppReminderJob = require('../../../models/WhatsAppReminderJob');

describe('durable job consistency', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test('booking creates exactly three reminder jobs', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const booking = await createBooking();
    const res = await ensureJobsForBooking(booking, clock.opts());
    assert.equal(res.jobs.length, 3);
    await assertOneJobPerKind(booking._id);
  });

  test('concurrent ensure is idempotent', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const booking = await createBooking();
    await parallelRuns(10, () => ensureJobsForBooking(booking, clock.opts()));
    await assertOneJobPerKind(booking._id);
  });

  test('E11000 upsert path keeps single row per kind', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const booking = await createBooking();
    await ensureJobsForBooking(booking, clock.opts());
    const existing = await WhatsAppReminderJob.findOne({
      formSubmissionId: booking._id,
      messageKind: 'pre4hr'
    }).lean();

    const setDoc = {
      phone: booking.phone,
      slotDate: booking.step3Data.slotDate,
      slotDayIst: existing.slotDayIst,
      scheduledSendAt: existing.scheduledSendAt,
      expiresAt: existing.expiresAt,
      firstEligibleAt: existing.firstEligibleAt,
      retryGroupId: existing.retryGroupId,
      updatedAt: clock.now()
    };
    await parallelRuns(5, () =>
      upsertReminderJob(
        booking._id,
        'pre4hr',
        setDoc,
        { createdAt: clock.now() },
        existing
      )
    );
    const n = await WhatsAppReminderJob.countDocuments({
      formSubmissionId: booking._id,
      messageKind: 'pre4hr'
    });
    assert.equal(n, 1);
  });

  test('no orphan events without retry group', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const booking = await createBooking();
    await ensureJobsForBooking(booking, clock.opts());
    await assertNoOrphanEvents();
  });
});
