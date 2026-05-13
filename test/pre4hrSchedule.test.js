'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  getPre4hrSlotDateBoundsForCron,
  isSlotDateInPre4hrCronWindow,
  DEFAULT_OFFSET_MS,
  DEFAULT_WINDOW_MS
} = require('../utils/pre4hrSchedule');

const fixedNow = new Date('2026-05-12T07:00:00.000Z'); // anchor
const cfg = { offsetMs: DEFAULT_OFFSET_MS, windowMs: DEFAULT_WINDOW_MS };

describe('getPre4hrSlotDateBoundsForCron', () => {
  test('band is backward from now + 4h with default 10m width', () => {
    const { slotDateMin, slotDateMax, offsetMs, windowMs, deadlineForwardSlackMs } = getPre4hrSlotDateBoundsForCron(
      fixedNow,
      cfg
    );
    assert.equal(offsetMs, DEFAULT_OFFSET_MS);
    assert.equal(windowMs, DEFAULT_WINDOW_MS);
    const deadline = fixedNow.getTime() + DEFAULT_OFFSET_MS;
    assert.equal(slotDateMin.getTime(), deadline - DEFAULT_WINDOW_MS);
    assert.equal(slotDateMax.getTime(), deadline + deadlineForwardSlackMs);
  });
});

describe('isSlotDateInPre4hrCronWindow', () => {
  test('slot exactly at deadline is included', () => {
    const deadline = new Date(fixedNow.getTime() + DEFAULT_OFFSET_MS);
    assert.equal(isSlotDateInPre4hrCronWindow(deadline, fixedNow, cfg), true);
  });

  test('slot at min boundary inclusive', () => {
    const { slotDateMin } = getPre4hrSlotDateBoundsForCron(fixedNow, cfg);
    assert.equal(isSlotDateInPre4hrCronWindow(slotDateMin, fixedNow, cfg), true);
  });

  test('slot at max boundary inclusive', () => {
    const { slotDateMax } = getPre4hrSlotDateBoundsForCron(fixedNow, cfg);
    assert.equal(isSlotDateInPre4hrCronWindow(slotDateMax, fixedNow, cfg), true);
  });

  test('slot just below min is excluded', () => {
    const { slotDateMin } = getPre4hrSlotDateBoundsForCron(fixedNow, cfg);
    const before = new Date(slotDateMin.getTime() - 1);
    assert.equal(isSlotDateInPre4hrCronWindow(before, fixedNow, cfg), false);
  });

  test('slot just above max is excluded', () => {
    const { slotDateMax } = getPre4hrSlotDateBoundsForCron(fixedNow, cfg);
    const after = new Date(slotDateMax.getTime() + 1);
    assert.equal(isSlotDateInPre4hrCronWindow(after, fixedNow, cfg), false);
  });

  test('legacy rolling window slot (now + 2h) is excluded', () => {
    const twoHoursAhead = new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000);
    assert.equal(isSlotDateInPre4hrCronWindow(twoHoursAhead, fixedNow, cfg), false);
  });

  test('invalid slotDate is excluded', () => {
    assert.equal(isSlotDateInPre4hrCronWindow('not-a-date', fixedNow, cfg), false);
  });
});
