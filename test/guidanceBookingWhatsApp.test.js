'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGuidancePre30MinReminderVars,
  GUIDANCE_PRE30MIN_REMINDER_PARAM_KEYS,
} = require('../utils/guidanceBookingWhatsApp');

describe('guidanceBookingWhatsApp pre30 reminder vars', () => {
  test('param keys are name and slottime', () => {
    assert.deepEqual(GUIDANCE_PRE30MIN_REMINDER_PARAM_KEYS, ['name', 'slottime']);
  });

  test('buildGuidancePre30MinReminderVars maps lead name and slot time string', () => {
    const vars = buildGuidancePre30MinReminderVars(
      { studentName: 'Teja' },
      { slotTime: '3:30 PM TO 4:30 PM' }
    );
    assert.deepEqual(vars, {
      name: 'Teja',
      slottime: '3:30 PM TO 4:30 PM',
    });
  });

  test('buildGuidancePre30MinReminderVars falls back for missing fields', () => {
    const vars = buildGuidancePre30MinReminderVars({}, {});
    assert.deepEqual(vars, {
      name: 'Student',
      slottime: '—',
    });
  });
});
