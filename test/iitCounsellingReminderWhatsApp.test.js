'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveIitReminderTemplateEnvKey,
  isIitReminderTemplateEnvKey,
  isIitReminderMessageKind,
  IIT_REMINDER_TEMPLATE_ENV,
} = require('../utils/iitCounsellingWhatsApp');

const ALL_REMINDER_ENV_KEYS = [
  ...Object.values(IIT_REMINDER_TEMPLATE_ENV.weekday).flatMap((o) => Object.values(o)),
  ...Object.values(IIT_REMINDER_TEMPLATE_ENV.sunday).flatMap((o) => Object.values(o)),
];

describe('resolveIitReminderTemplateEnvKey', () => {
  const snapshot = {};

  beforeEach(() => {
    for (const k of ALL_REMINDER_ENV_KEYS) {
      snapshot[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ALL_REMINDER_ENV_KEYS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  test('weekday Telugu 2hr', () => {
    process.env.GUPSHUP_TEMPLATE_IIT_PRE2HR_TELUGU = 'tpl-wd-2h-te';
    assert.equal(
      resolveIitReminderTemplateEnvKey({
        slotBooking: 'Wednesday 6PM',
        preferredLanguage: 'Telugu',
        reminderKind: 'iit_pre2hr',
      }),
      'GUPSHUP_TEMPLATE_IIT_PRE2HR_TELUGU'
    );
  });

  test('weekday Hindi 45min', () => {
    process.env.GUPSHUP_TEMPLATE_IIT_PRE45MIN_HINDI = 'tpl-wd-45-hi';
    assert.equal(
      resolveIitReminderTemplateEnvKey({
        slotBooking: 'Saturday 6PM',
        preferredLanguage: 'Hindi',
        reminderKind: 'iit_pre45min',
      }),
      'GUPSHUP_TEMPLATE_IIT_PRE45MIN_HINDI'
    );
  });

  test('Sunday Telugu 15min', () => {
    process.env.GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE15MIN_TELUGU = 'tpl-sun-15-te';
    assert.equal(
      resolveIitReminderTemplateEnvKey({
        slotBooking: 'Sunday 11AM',
        preferredLanguage: 'Telugu',
        reminderKind: 'iit_pre15min',
      }),
      'GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE15MIN_TELUGU'
    );
  });

  test('returns null when env unset', () => {
    assert.equal(
      resolveIitReminderTemplateEnvKey({
        slotBooking: 'Sunday 11AM',
        preferredLanguage: 'Hindi',
        reminderKind: 'iit_pre2hr',
      }),
      null
    );
  });

  test('rejects invalid language', () => {
    process.env.GUPSHUP_TEMPLATE_IIT_PRE2HR_TELUGU = 'x';
    assert.equal(
      resolveIitReminderTemplateEnvKey({
        slotBooking: 'Wednesday 6PM',
        preferredLanguage: 'English',
        reminderKind: 'iit_pre2hr',
      }),
      null
    );
  });
});

describe('isIitReminderMessageKind', () => {
  test('recognizes IIT reminder kinds', () => {
    assert.equal(isIitReminderMessageKind('iit_pre2hr'), true);
    assert.equal(isIitReminderMessageKind('pre4hr'), false);
  });
});

describe('isIitReminderTemplateEnvKey', () => {
  test('recognizes reminder env keys', () => {
    assert.equal(isIitReminderTemplateEnvKey('GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE45MIN_HINDI'), true);
    assert.equal(isIitReminderTemplateEnvKey('GUPSHUP_TEMPLATE_PRE4HR'), false);
  });
});
