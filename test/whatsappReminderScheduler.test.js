'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeScheduledSendAt,
  computeSlotDayIst,
  CAMPAIGN_MESSAGE_KINDS
} = require('../services/whatsappReminderScheduler');
const { getCampaignReminderEligibility } = require('../utils/waReminderEligibility');
const { offsetMsForKind } = require('../utils/waReminderEligibility');

describe('whatsappReminderScheduler', () => {
  test('A: booking creates three kinds with scheduledSendAt = slotDate − offset', () => {
    const slot = new Date('2026-08-15T14:00:00.000Z');
    assert.equal(CAMPAIGN_MESSAGE_KINDS.length, 3);
    for (const kind of CAMPAIGN_MESSAGE_KINDS) {
      const scheduled = computeScheduledSendAt(kind, slot);
      const off = offsetMsForKind(kind);
      assert.ok(scheduled instanceof Date);
      assert.equal(scheduled.getTime(), slot.getTime() - off);
      assert.ok(scheduled.getTime() < slot.getTime());
    }
  });

  test('G: one job per messageKind (unique campaign kinds)', () => {
    assert.deepEqual([...new Set(CAMPAIGN_MESSAGE_KINDS)].sort(), ['30min', 'meet', 'pre4hr'].sort());
    assert.equal(CAMPAIGN_MESSAGE_KINDS.length, 3);
  });

  test('D: late booking — scheduledSendAt already in the past while slot still future', () => {
    const now = new Date('2026-08-15T12:00:00.000Z');
    const slot = new Date('2026-08-15T13:30:00.000Z');
    const scheduled = computeScheduledSendAt('pre4hr', slot);
    assert.ok(scheduled.getTime() <= now.getTime());
    const elig = getCampaignReminderEligibility('pre4hr', slot, now);
    assert.equal(elig.ok, true);
  });

  test('computeSlotDayIst returns YYYY-MM-DD', () => {
    const day = computeSlotDayIst(new Date('2026-08-15T14:00:00.000Z'));
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('invalid slot returns null scheduledSendAt', () => {
    assert.equal(computeScheduledSendAt('pre4hr', 'not-a-date'), null);
  });
});
