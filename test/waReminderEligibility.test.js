'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  getCampaignReminderEligibility,
  shouldSendCampaignReminderImmediately,
  assertCampaignSendNotEarly
} = require('../utils/waReminderEligibility');

function ist(date, hhmm) {
  return new Date(`${date}T${hhmm}:00+05:30`);
}

const SLOT = ist('2026-05-13', '18:00');

describe('waReminderEligibility', () => {
  test('pre4hr: too early before T-4h', () => {
    const now = ist('2026-05-13', '13:59');
    const r = getCampaignReminderEligibility('pre4hr', SLOT, now);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'before_eligibility');
  });

  test('pre4hr: eligible at exactly T-4h', () => {
    const now = ist('2026-05-13', '14:00');
    const r = getCampaignReminderEligibility('pre4hr', SLOT, now);
    assert.equal(r.ok, true);
  });

  test('pre4hr: Case B catch-up between T-4h and slot', () => {
    const now = ist('2026-05-13', '15:00');
    assert.equal(shouldSendCampaignReminderImmediately('pre4hr', SLOT, now), true);
  });

  test('pre4hr: Case C never after slot', () => {
    const now = ist('2026-05-13', '18:01');
    const r = getCampaignReminderEligibility('pre4hr', SLOT, now);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'slot_passed');
  });

  test('meet: eligible at T-1h boundary', () => {
    const now = ist('2026-05-13', '17:00');
    assert.equal(getCampaignReminderEligibility('meet', SLOT, now).ok, true);
  });

  test('30min: eligible at T-30m boundary', () => {
    const now = ist('2026-05-13', '17:30');
    assert.equal(getCampaignReminderEligibility('30min', SLOT, now).ok, true);
  });

  test('assertCampaignSendNotEarly throws before T-4h', () => {
    const now = ist('2026-05-13', '13:59');
    assert.throws(() => assertCampaignSendNotEarly('pre4hr', SLOT, now), /before_eligibility/);
  });

  test('assertCampaignSendNotEarly passes at T-4h', () => {
    const now = ist('2026-05-13', '14:00');
    assert.doesNotThrow(() => assertCampaignSendNotEarly('pre4hr', SLOT, now));
  });
});
