'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  getMeetCronConfigFromEnv,
  getMeetSlotDateBoundsForCron,
  get30MinCronConfigFromEnv,
  get30MinSlotDateBoundsForCron,
  isSlotDateInCronWindow,
  DEFAULT_MEET_OFFSET_MS,
  DEFAULT_30MIN_OFFSET_MS,
  DEFAULT_CRON_WINDOW_MS
} = require('../utils/waSlotRelativeSchedule');

const fixedNow = new Date('2026-05-12T10:00:00.000Z');
const meetCfg = { offsetMs: DEFAULT_MEET_OFFSET_MS, windowMs: DEFAULT_CRON_WINDOW_MS };
const thirtyCfg = { offsetMs: DEFAULT_30MIN_OFFSET_MS, windowMs: DEFAULT_CRON_WINDOW_MS };

describe('meet slot-relative band', () => {
  test('slot at now+1h is inside meet band', () => {
    const slot = new Date(fixedNow.getTime() + DEFAULT_MEET_OFFSET_MS);
    assert.equal(isSlotDateInCronWindow(slot, fixedNow, meetCfg), true);
  });

  test('slot at now+30m is outside meet band (not rolling next-hour)', () => {
    const slot = new Date(fixedNow.getTime() + 30 * 60 * 1000);
    assert.equal(isSlotDateInCronWindow(slot, fixedNow, meetCfg), false);
  });

  test('getMeetSlotDateBoundsForCron centers on now+1h', () => {
    const { slotDateMin, slotDateMax } = getMeetSlotDateBoundsForCron(fixedNow, meetCfg);
    const center = fixedNow.getTime() + DEFAULT_MEET_OFFSET_MS;
    const half = DEFAULT_CRON_WINDOW_MS / 2;
    assert.equal(slotDateMin.getTime(), center - half);
    assert.equal(slotDateMax.getTime(), center + half);
  });

  test('getMeetCronConfigFromEnv returns positive offsets', () => {
    const c = getMeetCronConfigFromEnv();
    assert.ok(c.offsetMs > 0);
    assert.ok(c.windowMs >= 60 * 1000);
  });
});

describe('30min slot-relative band', () => {
  test('slot at now+30m is inside 30min band', () => {
    const slot = new Date(fixedNow.getTime() + DEFAULT_30MIN_OFFSET_MS);
    assert.equal(isSlotDateInCronWindow(slot, fixedNow, thirtyCfg), true);
  });

  test('slot at now+1h is outside 30min band (not rolling next-30m)', () => {
    const slot = new Date(fixedNow.getTime() + DEFAULT_MEET_OFFSET_MS);
    assert.equal(isSlotDateInCronWindow(slot, fixedNow, thirtyCfg), false);
  });

  test('get30MinSlotDateBoundsForCron centers on now+30m', () => {
    const { slotDateMin, slotDateMax } = get30MinSlotDateBoundsForCron(fixedNow, thirtyCfg);
    const center = fixedNow.getTime() + DEFAULT_30MIN_OFFSET_MS;
    const half = DEFAULT_CRON_WINDOW_MS / 2;
    assert.equal(slotDateMin.getTime(), center - half);
    assert.equal(slotDateMax.getTime(), center + half);
  });
});
