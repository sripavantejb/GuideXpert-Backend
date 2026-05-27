'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  paramKeysForIitReminder,
  buildIitReminderTemplateParams,
  sanitizeReminderName,
} = require('../utils/iitReminderWhatsAppSend');

describe('iitReminderWhatsAppSend', () => {
  test('sanitizeReminderName trims and caps length', () => {
    assert.equal(sanitizeReminderName('  Shiva  '), 'Shiva');
    assert.equal(sanitizeReminderName('').length > 0, true);
  });

  test('pre2hr attempt 1 uses name profile by default', () => {
    const prev = process.env.GUPSHUP_IIT_PRE2HR_PARAM_PROFILES;
    delete process.env.GUPSHUP_IIT_PRE2HR_PARAM_PROFILES;
    try {
      assert.deepEqual(paramKeysForIitReminder('iit_pre2hr', 1), ['name']);
      assert.deepEqual(paramKeysForIitReminder('iit_pre2hr', 2), []);
      assert.deepEqual(paramKeysForIitReminder('iit_pre45min', 1), ['name']);
    } finally {
      if (prev === undefined) delete process.env.GUPSHUP_IIT_PRE2HR_PARAM_PROFILES;
      else process.env.GUPSHUP_IIT_PRE2HR_PARAM_PROFILES = prev;
    }
  });

  test('buildIitReminderWhatsAppVars fills time from slotBooking label', () => {
    const { buildIitReminderWhatsAppVars } = require('../utils/iitReminderWhatsAppSend');
    const vars = buildIitReminderWhatsAppVars({
      fullName: 'Test',
      counsellingSlotInstantUtc: new Date('2026-05-27T12:30:00.000Z'),
      iitCounselling: {
        section1Data: { fullName: 'Test', slotBooking: 'Wednesday 6PM' },
      },
    });
    assert.equal(vars.time, '6:00 PM');
  });

  test('buildIitReminderTemplateParams maps vars to ordered values', () => {
    const params = buildIitReminderTemplateParams(
      { name: 'Asha', date: 'Wed, 27th May', time: '6:00 PM' },
      'iit_pre2hr',
      3
    );
    assert.deepEqual(params, ['Asha', 'Wed, 27th May', '6:00 PM']);
  });
});
