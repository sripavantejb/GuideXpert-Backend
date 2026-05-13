'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { resolveIitSlotBookedTemplateEnvKey, isIitSlotBookedTemplateEnvKey } = require('../utils/iitCounsellingWhatsApp');
const { buildParamsFromKeys, SLOT_BOOKED_IIT_PARAM_KEYS, SLOT_BOOKED_PARAM_KEYS } = require('../utils/gupshupWhatsAppTemplateParams');

const ENV_KEYS = [
  'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY',
  'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY',
  'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SUNDAY',
  'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED'
];

describe('resolveIitSlotBookedTemplateEnvKey', () => {
  const snapshot = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      snapshot[k] = Object.prototype.hasOwnProperty.call(process.env, k)
        ? process.env[k]
        : undefined;
    }
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  test('picks Wednesday key when configured', () => {
    process.env.GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY = 'tpl-wed-id';
    assert.equal(resolveIitSlotBookedTemplateEnvKey('Wednesday 6PM'), 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY');
  });

  test('picks Saturday key when configured', () => {
    process.env.GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY = 'tpl-sat-id';
    assert.equal(resolveIitSlotBookedTemplateEnvKey('Saturday 6PM'), 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY');
  });

  test('picks Sunday key when configured', () => {
    process.env.GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SUNDAY = 'tpl-sun-id';
    assert.equal(resolveIitSlotBookedTemplateEnvKey('Sunday 11AM'), 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SUNDAY');
  });

  test('falls back to legacy IIT key when primary day env is unset but legacy value exists', () => {
    process.env.GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED = 'legacy-id';
    assert.equal(resolveIitSlotBookedTemplateEnvKey('Wednesday 6PM'), 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED');
  });

  test('does not prefer legacy while day-specific env is configured', () => {
    process.env.GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY = 'sat-real';
    process.env.GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED = 'legacy-not-used-here';
    assert.equal(resolveIitSlotBookedTemplateEnvKey('Saturday 6PM'), 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY');
  });

  test('returns null when neither day nor legacy is configured', () => {
    assert.equal(resolveIitSlotBookedTemplateEnvKey('Sunday 11AM'), null);
  });
});

describe('isIitSlotBookedTemplateEnvKey', () => {
  test('recognizes per-day and legacy IIT slot_booked env key names', () => {
    assert.equal(isIitSlotBookedTemplateEnvKey('GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY'), true);
    assert.equal(isIitSlotBookedTemplateEnvKey('GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY'), true);
    assert.equal(isIitSlotBookedTemplateEnvKey('GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SUNDAY'), true);
    assert.equal(isIitSlotBookedTemplateEnvKey('GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED'), true);
    assert.equal(isIitSlotBookedTemplateEnvKey('  GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SUNDAY  '), true);
  });

  test('rejects non-IIT template env keys', () => {
    assert.equal(isIitSlotBookedTemplateEnvKey('GUPSHUP_TEMPLATE_REMINDER'), false);
    assert.equal(isIitSlotBookedTemplateEnvKey(''), false);
    assert.equal(isIitSlotBookedTemplateEnvKey(null), false);
  });
});

describe('IIT slot_booked Gupshup params', () => {
  test('SLOT_BOOKED_IIT_PARAM_KEYS builds a single name param from vars', () => {
    const vars = { name: 'Asha', date: 'Wednesday, 14th May', time: '6:00 PM' };
    assert.deepEqual(buildParamsFromKeys(vars, SLOT_BOOKED_IIT_PARAM_KEYS), ['Asha']);
  });

  test('GuideXpert slot_booked still uses two placeholders', () => {
    const vars = { Name: 'Raj', date: 'Thu, 15th May', time: '11:00 AM' };
    const two = buildParamsFromKeys(vars, SLOT_BOOKED_PARAM_KEYS);
    assert.equal(two.length, 2);
    assert.equal(two[0], 'Raj');
    assert.match(two[1], /May/);
  });
});
