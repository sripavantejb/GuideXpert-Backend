'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { resolveGuidanceCounselorMeetLink } = require('../constants/guidanceCounselorMeetLinks');
const {
  parseGuidanceSlotTimeWindow,
  isWithinGuidanceSlotWindow,
  parseTimeToken,
} = require('../utils/guidanceSlotTimeWindow');

describe('guidanceCounselorMeetLinks', () => {
  test('resolveGuidanceCounselorMeetLink matches counsellor names', () => {
    assert.equal(
      resolveGuidanceCounselorMeetLink('VEDANSH - IIT ROORKEE'),
      'https://meet.google.com/dhg-mcvj-rac'
    );
    assert.equal(
      resolveGuidanceCounselorMeetLink('DIVYA - IIT DELHI'),
      'https://meet.google.com/oaq-uqzi-vwf'
    );
    assert.equal(
      resolveGuidanceCounselorMeetLink('Avijit Pandey'),
      'https://meet.google.com/hak-qjso-rmp'
    );
    assert.equal(
      resolveGuidanceCounselorMeetLink('MANISHA SR. COUNSELLOR'),
      'https://meet.google.com/yuk-qwui-fse'
    );
    assert.equal(
      resolveGuidanceCounselorMeetLink('Maneesha'),
      'https://meet.google.com/yuk-qwui-fse'
    );
  });

  test('listCounselorsWithoutMeetLinks filters unmapped names', () => {
    const { listCounselorsWithoutMeetLinks } = require('../constants/guidanceCounselorMeetLinks');
    assert.deepEqual(listCounselorsWithoutMeetLinks(['Maneesha', 'Unknown Counsellor', 'DIVYA']), [
      'Unknown Counsellor',
    ]);
  });

  test('resolveGuidanceCounselorMeetLink returns null for unknown names', () => {
    assert.equal(resolveGuidanceCounselorMeetLink('Unknown Person'), null);
    assert.equal(resolveGuidanceCounselorMeetLink(''), null);
  });
});

describe('guidanceSlotTimeWindow', () => {
  test('parseTimeToken handles common formats', () => {
    assert.deepEqual(parseTimeToken('1:00 PM'), { hour: 13, minute: 0 });
    assert.deepEqual(parseTimeToken('11AM'), { hour: 11, minute: 0 });
    assert.deepEqual(parseTimeToken('6:00 PM'), { hour: 18, minute: 0 });
  });

  test('parseGuidanceSlotTimeWindow parses TO and dash ranges', () => {
    const slot = { slotDate: '2026-06-13', slotTime: '1:00 PM TO 2:00 PM' };
    const window = parseGuidanceSlotTimeWindow(slot);
    assert.ok(window);
    assert.equal(window.startLabel, '1:00 PM');
    assert.equal(window.endLabel, '2:00 PM');
    assert.equal(window.slotDateLabel, '13 Jun 2026');
    assert.equal(window.startUtc.getUTCHours(), 7);
    assert.equal(window.startUtc.getUTCMinutes(), 30);
    assert.equal(window.endUtc.getUTCHours(), 8);
    assert.equal(window.endUtc.getUTCMinutes(), 30);
  });

  test('isWithinGuidanceSlotWindow allows join 5 minutes early', () => {
    const slot = { slotDate: '2026-06-13', slotTime: '1:00 PM TO 2:00 PM' };
    const sixMinEarly = new Date('2026-06-13T07:24:00.000Z'); // 12:54 IST
    const exactlyFiveMinEarly = new Date('2026-06-13T07:25:00.000Z'); // 12:55 IST
    const during = new Date('2026-06-13T07:45:00.000Z'); // 13:15 IST
    const after = new Date('2026-06-13T08:31:00.000Z'); // 14:01 IST

    assert.equal(isWithinGuidanceSlotWindow(slot, sixMinEarly).allowed, false);
    assert.equal(isWithinGuidanceSlotWindow(slot, exactlyFiveMinEarly).allowed, true);
    assert.equal(isWithinGuidanceSlotWindow(slot, during).allowed, true);
    assert.equal(isWithinGuidanceSlotWindow(slot, after).allowed, false);
  });

  test('getGuidanceSlotBookingStatus freezes 30 minutes before start and hides ended slots', () => {
    const { getGuidanceSlotBookingStatus } = require('../utils/guidanceSlotTimeWindow');
    const slot = { slotDate: '2026-06-13', slotTime: '1:00 PM TO 2:00 PM' };

    assert.equal(getGuidanceSlotBookingStatus(slot, new Date('2026-06-13T06:59:00.000Z')).status, 'bookable');
    assert.equal(getGuidanceSlotBookingStatus(slot, new Date('2026-06-13T07:00:00.000Z')).status, 'frozen');
    assert.equal(getGuidanceSlotBookingStatus(slot, new Date('2026-06-13T07:45:00.000Z')).status, 'frozen');
    assert.equal(getGuidanceSlotBookingStatus(slot, new Date('2026-06-13T08:31:00.000Z')).status, 'ended');
  });
});
