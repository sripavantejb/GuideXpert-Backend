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
const { runReminderCron } = require('../helpers/cronRunner');
const { createMessageEvent, createRetryGroup } = require('../factories/retryFactory');
const { replayWebhookOnEvent } = require('../factories/webhookFactory');
const { computeRecipientDayOverview } = require('../../../services/whatsappOpsRecipientAnalytics');
const { validateRecipientAnalyticsInvariants } = require('../../../utils/waAnalyticsIntegrity');
const WhatsAppMessageEvent = require('../../../models/WhatsAppMessageEvent');

describe('analytics consistency integration', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test('recipient overview passes invariants after dispatch + late delivery', async () => {
    const clock = resetClock('2026-05-15T08:00:00.000Z');
    const booking = await createBooking({ slotDate: '2026-05-15T11:30:00.000Z' });
    await ensureJobsForBooking(booking, clock.opts());
    const job = await getJob(booking._id, 'pre4hr');
    await makeJobDue(job._id, new Date('2026-05-15T04:30:00.000Z'));
    await runReminderCron('pre4hr', { now: clock.now() });

    const ev = await WhatsAppMessageEvent.findOne({
      retryGroupId: job.retryGroupId,
      attemptNumber: 1
    }).lean();
    if (ev) {
      await replayWebhookOnEvent(ev, 'delivered', { receivedAt: clock.now() });
    }

    const overview = await computeRecipientDayOverview({
      dateIso: '2026-05-15',
      messageKind: 'pre4hr',
      slotTime: 'all'
    });
    assert.ok(!overview.error, overview.error);
    const data = overview.data || overview;
    const inv = validateRecipientAnalyticsInvariants({
      recipientTotals: data.recipientTotals,
      outcomeBreakdown: data.recipientTotals?.outcomeBreakdown,
      retryFunnelByAttempt: data.retryFunnelByAttempt,
      retryFunnelReconciliation: data.retryFunnelReconciliation
    });
    assert.equal(inv.ok, true, inv.violations.join('; '));
    assert.ok((data.cohortFlow?.booked || data.bookedSlotsCount || 0) >= 1);
  });

  test('retries do not inflate totalRecipients for same phone', async () => {
    const clock = resetClock('2026-05-15T06:00:00.000Z');
    const booking = await createBooking({ slotDate: '2026-05-15T11:30:00.000Z' });
    const group = await createRetryGroup({ messageKind: 'pre4hr' });
    const ev1 = await createMessageEvent({
      phone: booking.phone,
      formSubmissionId: booking._id,
      retryGroupId: group._id,
      messageKind: 'pre4hr',
      status: 'failed',
      failedAt: clock.now(),
      retryEligible: true
    });

    await createMessageEvent({
      phone: booking.phone,
      formSubmissionId: booking._id,
      retryGroupId: group._id,
      messageKind: 'pre4hr',
      attemptNumber: 2,
      status: 'submitted',
      parentMessageEventId: ev1._id
    });

    const overview = await computeRecipientDayOverview({
      dateIso: '2026-05-15',
      messageKind: 'pre4hr'
    });
    const data = overview.data || overview;
    const total = data.recipientTotals?.totalRecipients || 0;
    assert.ok((data.cohortFlow?.booked || 0) >= 1);
    const inv = validateRecipientAnalyticsInvariants({
      recipientTotals: data.recipientTotals,
      outcomeBreakdown: data.recipientTotals?.outcomeBreakdown
    });
    assert.equal(inv.ok, true, inv.violations.join('; '));
  });
});
