'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  formatGuidanceBookingDate,
  buildGuidanceBookingSubmitVars,
  parseGuidanceSlotInstantUtc,
} = require('../utils/guidanceBookingWhatsApp');

describe('guidanceBookingWhatsApp', () => {
  test('formatGuidanceBookingDate renders human-readable IST label', () => {
    assert.equal(formatGuidanceBookingDate('2026-06-04'), '4 Jun 2026');
  });

  test('formatGuidanceBookingDate returns em dash for invalid input', () => {
    assert.equal(formatGuidanceBookingDate(''), '—');
    assert.equal(formatGuidanceBookingDate('not-a-date'), 'not-a-date');
  });

  test('buildGuidanceBookingSubmitVars maps date and time', () => {
    assert.deepEqual(
      buildGuidanceBookingSubmitVars({ slotDate: '2026-06-04', slotTime: '6:00 PM' }),
      { date: '4 Jun 2026', time: '6:00 PM' }
    );
  });

  test('buildGuidanceBookingSubmitVars falls back time to em dash', () => {
    assert.deepEqual(buildGuidanceBookingSubmitVars({ slotDate: '2026-06-04' }), {
      date: '4 Jun 2026',
      time: '—',
    });
  });

  test('parseGuidanceSlotInstantUtc uses slot hour when parseable', () => {
    const d = parseGuidanceSlotInstantUtc({ slotDate: '2026-06-04', slotTime: '6:00 PM' });
    assert.ok(d instanceof Date);
    assert.equal(d.getUTCHours(), 12);
    assert.equal(d.getUTCMinutes(), 30);
  });

  test('parseGuidanceSlotInstantUtc anchors noon IST when time missing', () => {
    const d = parseGuidanceSlotInstantUtc({ slotDate: '2026-06-04', slotTime: '' });
    assert.ok(d instanceof Date);
    assert.equal(d.getUTCHours(), 6);
    assert.equal(d.getUTCMinutes(), 30);
  });
});
