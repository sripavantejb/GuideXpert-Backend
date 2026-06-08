const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeCallbackTimeFromSlot,
  isCallbackTimeInPast,
  ONE_HOUR_MS,
} = require('../utils/aiCallReminderTiming');

describe('aiCallReminderTiming', () => {
  it('computes callback 1 hour before slot', () => {
    const slot = new Date('2026-06-15T12:30:00.000Z');
    const callback = computeCallbackTimeFromSlot(slot);
    assert.equal(callback.getTime(), slot.getTime() - ONE_HOUR_MS);
  });

  it('returns null for invalid slot', () => {
    assert.equal(computeCallbackTimeFromSlot(null), null);
    assert.equal(computeCallbackTimeFromSlot(new Date('invalid')), null);
  });

  it('detects past callback times', () => {
    const past = new Date(Date.now() - 60000);
    const future = new Date(Date.now() + 60000);
    assert.equal(isCallbackTimeInPast(past), true);
    assert.equal(isCallbackTimeInPast(future), false);
  });
});
