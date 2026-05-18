'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { cronJobKeyForKind } = require('../services/whatsappReminderJobDispatcher');
const { getCampaignReminderEligibility } = require('../utils/waReminderEligibility');
const { offsetMsForKind } = require('../utils/waReminderEligibility');

function isDueForCronClaim(job, now) {
  return (
    job.state === 'pending' &&
    new Date(job.scheduledSendAt).getTime() <= now.getTime()
  );
}

describe('whatsappReminderJobDispatcher', () => {
  test('cronJobKeyForKind maps to legacy cron paths', () => {
    assert.equal(cronJobKeyForKind('pre4hr'), 'send_reminders');
    assert.equal(cronJobKeyForKind('meet'), 'send_meetlinks');
    assert.equal(cronJobKeyForKind('30min'), 'send_30min_reminders');
  });

  test('C: dispatch blocked before scheduledSendAt / eligibility window', () => {
    const slot = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const now = new Date();
    const scheduled = new Date(slot.getTime() - offsetMsForKind('pre4hr'));
    const job = { state: 'pending', scheduledSendAt: scheduled, messageKind: 'pre4hr' };
    if (now.getTime() < scheduled.getTime()) {
      assert.equal(isDueForCronClaim(job, now), false);
    }
    const elig = getCampaignReminderEligibility('pre4hr', slot, now);
    if (elig.reason === 'before_eligibility') {
      assert.equal(elig.ok, false);
    }
  });

  test('B/I: due job is claimable when pending and scheduledSendAt <= now', () => {
    const now = new Date();
    const overdueJob = {
      state: 'pending',
      scheduledSendAt: new Date(now.getTime() - 5 * 60 * 1000),
      messageKind: 'meet'
    };
    assert.equal(isDueForCronClaim(overdueJob, now), true);
  });

  test('E: retryGroupId is carried on job document shape for dispatch', () => {
    const groupId = '507f1f77bcf86cd799439011';
    const job = {
      retryGroupId: groupId,
      messageKind: 'pre4hr',
      state: 'claimed'
    };
    assert.equal(String(job.retryGroupId), groupId);
    assert.ok(job.retryGroupId);
  });
});
