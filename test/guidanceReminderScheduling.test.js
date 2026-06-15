'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER,
} = require('../utils/guidanceBookingWhatsApp');
const {
  getGuidancePre30ScheduleDecision,
  computeGuidancePre30ScheduledSendAt,
  getGuidancePre30ReminderEligibility,
} = require('../utils/guidanceReminderEligibility');

const SLOT = { slotDate: '2026-06-13', slotTime: '3:30 PM TO 4:30 PM' };

describe('guidanceReminderScheduling', () => {
  let savedTemplate;

  before(() => {
    savedTemplate = process.env[GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER];
    process.env[GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER] = '1544482780736301';
  });

  after(() => {
    if (savedTemplate == null) delete process.env[GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER];
    else process.env[GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER] = savedTemplate;
  });

  test('computeGuidancePre30ScheduledSendAt is 30 minutes before slot start (IST)', () => {
    const sendAt = computeGuidancePre30ScheduledSendAt(SLOT);
    assert.ok(sendAt);
    assert.equal(sendAt.toISOString(), '2026-06-13T09:30:00.000Z');
  });

  test('schedules pending when booking is more than 30 minutes before start', () => {
    const now = new Date('2026-06-13T08:00:00.000Z');
    const decision = getGuidancePre30ScheduleDecision(SLOT, now);
    assert.equal(decision.state, 'pending');
    assert.equal(decision.suppressionReason, null);
    assert.ok(decision.scheduledSendAt);
  });

  test('catch-up pending when booking within 30 minutes of start (before session)', () => {
    const now = new Date('2026-06-13T09:45:00.000Z');
    const decision = getGuidancePre30ScheduleDecision(SLOT, now);
    assert.equal(decision.state, 'pending');
    assert.equal(decision.suppressionReason, null);
    assert.equal(decision.catchUp, true);
    assert.ok(decision.scheduledSendAt);
  });

  test('skips when slot already started', () => {
    const now = new Date('2026-06-13T10:30:00.000Z');
    const decision = getGuidancePre30ScheduleDecision(SLOT, now);
    assert.equal(decision.state, 'skipped');
    assert.equal(decision.suppressionReason, 'slot_passed');
  });

  test('dispatch eligibility defers before scheduled send time', () => {
    const now = new Date('2026-06-13T09:00:00.000Z');
    const elig = getGuidancePre30ReminderEligibility(SLOT, now);
    assert.equal(elig.ok, false);
    assert.equal(elig.reason, 'before_eligibility');
  });

  test('dispatch eligibility ok at scheduled send time', () => {
    const now = new Date('2026-06-13T09:30:00.000Z');
    const elig = getGuidancePre30ReminderEligibility(SLOT, now);
    assert.equal(elig.ok, true);
  });

  test('skips when template env is missing', () => {
    delete process.env[GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER];
    const decision = getGuidancePre30ScheduleDecision(SLOT, new Date('2026-06-13T08:00:00.000Z'));
    assert.equal(decision.state, 'skipped');
    assert.equal(decision.suppressionReason, 'template_env_missing');
    process.env[GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER] = '1544482780736301';
  });
});

describe('guidance pre30 job expiration', () => {
  test('computeExpiresAt stops at session start (no grace after start)', () => {
    const { computeExpiresAt } = require('../utils/waReminderJobExpiration');
    const slotStart = new Date('2026-06-13T10:00:00.000Z');
    const expires = computeExpiresAt('guidance_pre30min', slotStart);
    assert.equal(expires.toISOString(), slotStart.toISOString());
  });
});
