const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateLiveWindows,
  parseHHmm,
  istWallToUtc,
  istYmdAndDow,
} = require('../utils/demoMeetLiveWindows');

describe('parseHHmm', () => {
  test('parses valid 24h', () => {
    assert.deepEqual(parseHHmm('09:05'), { h: 9, min: 5 });
    assert.deepEqual(parseHHmm('19:00'), { h: 19, min: 0 });
  });
  test('rejects invalid', () => {
    assert.equal(parseHHmm('24:00'), null);
    assert.equal(parseHHmm('19'), null);
    assert.equal(parseHHmm(''), null);
  });
});

describe('istWallToUtc', () => {
  test('IST offset is applied', () => {
    const d = istWallToUtc(2026, 5, 11, { h: 19, min: 0 });
    assert.ok(d);
    assert.equal(d.toISOString(), '2026-05-11T13:30:00.000Z');
  });
});

describe('evaluateLiveWindows', () => {
  const schedule = {
    joinEarlyMinutes: 5,
    recurringWindows: [{ dayOfWeek: 1, startHHmm: '19:00', endHHmm: '20:00' }],
  };

  test('allowed during window (after join early open)', () => {
    const now = new Date('2026-05-11T13:35:00.000Z');
    const out = evaluateLiveWindows(schedule, now);
    assert.equal(out.phase, 'allowed');
    assert.ok(out.slotStart);
    assert.ok(out.slotEnd);
  });

  test('too early before join opens', () => {
    const now = new Date('2026-05-11T10:00:00.000Z');
    const out = evaluateLiveWindows(schedule, now);
    assert.equal(out.phase, 'too_early');
    assert.match(out.message || '', /not open yet/i);
    assert.ok(out.joinOpensAtLabel);
  });

  test('join opens 5 minutes before start', () => {
    const now = new Date('2026-05-11T13:24:59.999Z');
    const out = evaluateLiveWindows(schedule, now);
    assert.equal(out.phase, 'too_early');
    const joinOpens = new Date(out.joinOpensAt);
    const slotStart = new Date(out.slotStart);
    assert.equal(joinOpens.getTime(), slotStart.getTime() - 5 * 60 * 1000);
  });

  test('not allowed at exact window end', () => {
    const now = new Date('2026-05-11T14:30:00.000Z');
    const out = evaluateLiveWindows(schedule, now);
    assert.equal(out.phase, 'too_early');
  });

  test('no_windows when recurring empty', () => {
    const out = evaluateLiveWindows({ recurringWindows: [], joinEarlyMinutes: 5 }, new Date());
    assert.equal(out.phase, 'no_windows');
  });

  test('multiple windows same day — picks correct allowed', () => {
    const sched = {
      joinEarlyMinutes: 0,
      recurringWindows: [
        { dayOfWeek: 3, startHHmm: '10:00', endHHmm: '11:00' },
        { dayOfWeek: 3, startHHmm: '15:00', endHHmm: '16:00' },
      ],
    };
    const wed = new Date('2026-05-13T10:00:00.000Z');
    const parts = istYmdAndDow(wed);
    assert.equal(parts.dow, 3);
    const out = evaluateLiveWindows(sched, wed);
    assert.equal(out.phase, 'allowed');
    const start = new Date(out.slotStart);
    assert.equal(start.getUTCHours(), 9);
    assert.equal(start.getUTCMinutes(), 30);
  });

  test('week rollover finds next Monday', () => {
    const sched = {
      joinEarlyMinutes: 0,
      recurringWindows: [{ dayOfWeek: 1, startHHmm: '19:00', endHHmm: '20:00' }],
    };
    const sundayAfter = new Date('2026-05-17T15:00:00.000Z');
    const out = evaluateLiveWindows(sched, sundayAfter, { scanDays: 10 });
    assert.equal(out.phase, 'too_early');
    const nextStart = new Date(out.slotStart);
    assert.equal(nextStart.getUTCDay(), 1);
  });
});
