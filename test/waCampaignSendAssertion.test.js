'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildEligibilityTimingRecord } = require('../utils/waCampaignSendAssertion');

function ist(date, hhmm) {
  return new Date(`${date}T${hhmm}:00+05:30`);
}

describe('waCampaignSendAssertion / buildEligibilityTimingRecord', () => {
  test('pre4hr 6PM slot: not early exactly at T-4h', () => {
    const slot = ist('2026-05-13', '18:00');
    const sent = ist('2026-05-13', '14:00');
    const t = buildEligibilityTimingRecord('pre4hr', slot, sent);
    assert.equal(t.sentTooEarly, false);
    assert.equal(t.sentAfterExpiry, false);
    assert.ok(t.firstEligibleAt);
    assert.ok(Number.isFinite(t.eligibilityViolationDeltaMs));
    assert.equal(t.eligibilityViolationDeltaMs >= 0, true);
  });

  test('pre4hr 6PM slot: early flag before T-4h', () => {
    const slot = ist('2026-05-13', '18:00');
    const sent = ist('2026-05-13', '13:59');
    const t = buildEligibilityTimingRecord('pre4hr', slot, sent);
    assert.equal(t.sentTooEarly, true);
    assert.ok(t.eligibilityViolationDeltaMs < 0);
  });

  test('meet: sentAfterExpiry when sent at slot instant', () => {
    const slot = ist('2026-05-13', '18:00');
    const sent = ist('2026-05-13', '18:00');
    const t = buildEligibilityTimingRecord('meet', slot, sent);
    assert.equal(t.sentAfterExpiry, true);
  });

  test('slot_booked yields null timing record', () => {
    const slot = ist('2026-05-13', '18:00');
    const sent = ist('2026-05-13', '14:00');
    assert.equal(buildEligibilityTimingRecord('slot_booked', slot, sent), null);
  });
});
