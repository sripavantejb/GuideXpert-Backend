'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildParamsFromKeys } = require('../utils/gupshupWhatsAppTemplateParams');
const {
  buildGuidanceCounsellorBookingNotifyVars,
  GUIDANCE_COUNSELLOR_BOOKING_NOTIFY_PARAM_KEYS,
} = require('../utils/guidanceBookingWhatsApp');
const {
  resolveGuidanceCounselorPhone10,
  resolveGuidanceCounselorPhoneFallback10,
} = require('../constants/guidanceCounselorPhones');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');

describe('buildGuidanceCounsellorBookingNotifyVars', () => {
  test('builds ordered vars for template params', () => {
    const vars = buildGuidanceCounsellorBookingNotifyVars(
      { studentName: 'Rahul' },
      { slotDate: '2026-06-15', slotTime: '3:30 PM TO 4:30 PM' },
      { name: 'V Divya' }
    );
    assert.deepEqual(vars, {
      name: 'Rahul',
      date: '15 Jun 2026',
      time: '3:30 PM TO 4:30 PM',
      counsellor: 'V Divya',
    });
    assert.deepEqual(
      buildParamsFromKeys(vars, GUIDANCE_COUNSELLOR_BOOKING_NOTIFY_PARAM_KEYS),
      ['V Divya', '15 Jun 2026', '3:30 PM TO 4:30 PM', 'Rahul']
    );
  });

  test('uses defaults when fields missing', () => {
    const vars = buildGuidanceCounsellorBookingNotifyVars({}, {}, {});
    assert.equal(vars.name, 'Student');
    assert.equal(vars.counsellor, 'Counsellor');
    assert.equal(vars.time, '—');
  });
});

describe('resolveGuidanceCounselorPhone10', () => {
  test('prefers DB mobile over name fallback', () => {
    assert.equal(
      resolveGuidanceCounselorPhone10({ name: 'V Divya', mobile: '9000000001' }),
      '9000000001'
    );
  });

  test('falls back to static map for V Divya', () => {
    assert.equal(resolveGuidanceCounselorPhone10({ name: 'V Divya' }), '9599697281');
  });

  test('falls back for Jayanth', () => {
    assert.equal(resolveGuidanceCounselorPhoneFallback10('Jayanth'), '8008277057');
    assert.equal(resolveGuidanceCounselorPhone10({ name: 'Jayanth' }), '8008277057');
  });

  test('returns null for unknown counsellor', () => {
    assert.equal(resolveGuidanceCounselorPhone10({ name: 'Unknown Person' }), null);
  });
});

describe('WhatsAppRetryGroup schema — guidance_counsellor_booking_notify', () => {
  test('accepts messageKind and trigger guidance_counsellor_booking_notify', () => {
    const doc = new WhatsAppRetryGroup({
      messageKind: 'guidance_counsellor_booking_notify',
      trigger: 'guidance_counsellor_booking_notify',
      status: 'open',
    });
    const err = doc.validateSync();
    assert.equal(err, undefined);
  });
});
