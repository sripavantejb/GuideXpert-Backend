'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeScheduledSendAt,
  evaluateScheduleAtCreation,
  buildAllTriggerSchedules,
  isPostSlotKind,
} = require('../utils/iitTeluguSmsSchedule');
const {
  buildFlowVariablesForKind,
  isStaticTeluguSmsTemplate,
  DEFAULT_IIT_COUNSELLING_MEET_LINK,
} = require('../config/iitTeluguSmsTemplates');

/** Saturday 6:00 PM IST */
const SLOT_SAT_6PM = new Date('2025-03-15T18:00:00+05:30');

describe('iitTeluguSmsSchedule', () => {
  test('computes offsets from slot T (Saturday 6 PM IST)', () => {
    assert.equal(
      computeScheduledSendAt('iit_sms_tminus_1d', SLOT_SAT_6PM).toISOString(),
      new Date('2025-03-14T18:00:00+05:30').toISOString()
    );
    assert.equal(
      computeScheduledSendAt('iit_sms_tminus_2h', SLOT_SAT_6PM).toISOString(),
      new Date('2025-03-15T16:00:00+05:30').toISOString()
    );
    assert.equal(
      computeScheduledSendAt('iit_sms_session_8am', SLOT_SAT_6PM).toISOString(),
      new Date('2025-03-15T08:00:00+05:30').toISOString()
    );
    assert.equal(
      computeScheduledSendAt('iit_sms_tminus_30m', SLOT_SAT_6PM).toISOString(),
      new Date('2025-03-15T17:30:00+05:30').toISOString()
    );
    assert.equal(
      computeScheduledSendAt('iit_sms_tminus_5m', SLOT_SAT_6PM).toISOString(),
      new Date('2025-03-15T17:55:00+05:30').toISOString()
    );
    assert.equal(
      computeScheduledSendAt('iit_sms_tplus_5m', SLOT_SAT_6PM).toISOString(),
      new Date('2025-03-15T18:05:00+05:30').toISOString()
    );
  });

  test('T-1 day skipped when booking within 24h of slot', () => {
    const now = new Date('2025-03-15T10:00:00+05:30');
    const sched = computeScheduledSendAt('iit_sms_tminus_1d', SLOT_SAT_6PM);
    const ev = evaluateScheduleAtCreation('iit_sms_tminus_1d', sched, SLOT_SAT_6PM, now);
    assert.equal(ev.state, 'skipped');
    assert.equal(ev.suppressionReason, 'missed_window');
    assert.equal(ev.sendImmediately, false);
  });

  test('session 8 AM skipped when booking after 8 AM on session day', () => {
    const now = new Date('2025-03-15T09:00:00+05:30');
    const sched = computeScheduledSendAt('iit_sms_session_8am', SLOT_SAT_6PM);
    const ev = evaluateScheduleAtCreation('iit_sms_session_8am', sched, SLOT_SAT_6PM, now);
    assert.equal(ev.state, 'skipped');
    assert.equal(ev.suppressionReason, 'missed_window');
  });

  test('T-2h immediate when booking inside final 2-hour window', () => {
    const now = new Date('2025-03-15T17:00:00+05:30');
    const sched = computeScheduledSendAt('iit_sms_tminus_2h', SLOT_SAT_6PM);
    const ev = evaluateScheduleAtCreation('iit_sms_tminus_2h', sched, SLOT_SAT_6PM, now);
    assert.equal(ev.state, 'pending');
    assert.equal(ev.sendImmediately, true);
  });

  test('T+5 is post-slot kind', () => {
    assert.equal(isPostSlotKind('iit_sms_tplus_5m'), true);
    assert.equal(isPostSlotKind('iit_sms_tminus_5m'), false);
  });

  test('buildAllTriggerSchedules marks T-2h sendImmediately in 2h window', () => {
    const now = new Date('2025-03-15T17:30:00+05:30');
    const all = buildAllTriggerSchedules(SLOT_SAT_6PM, now);
    assert.equal(all.iit_sms_tminus_2h.sendImmediately, true);
    assert.equal(all.iit_sms_tminus_1d.state, 'skipped');
  });

  test('static templates send no Flow variables', () => {
    assert.equal(isStaticTeluguSmsTemplate('iit_sms_tminus_1d'), true);
    assert.equal(isStaticTeluguSmsTemplate('iit_sms_tminus_2h'), true);
    assert.equal(isStaticTeluguSmsTemplate('iit_sms_session_8am'), true);
    assert.deepEqual(buildFlowVariablesForKind('iit_sms_tminus_1d'), {});
  });

  test('T-30m / T-5m / T+5m send meet link as var', () => {
    const prev = process.env.IIT_COUNSELLING_MEET_LINK;
    process.env.IIT_COUNSELLING_MEET_LINK = 'https://www.guidexpert.co.in/iitcounsellingmeet';
    try {
      for (const kind of ['iit_sms_tminus_30m', 'iit_sms_tminus_5m', 'iit_sms_tplus_5m']) {
        assert.deepEqual(buildFlowVariablesForKind(kind), {
          var: 'https://www.guidexpert.co.in/iitcounsellingmeet',
        });
      }
      assert.equal(DEFAULT_IIT_COUNSELLING_MEET_LINK, 'https://www.guidexpert.co.in/iitcounsellingmeet');
    } finally {
      if (prev === undefined) delete process.env.IIT_COUNSELLING_MEET_LINK;
      else process.env.IIT_COUNSELLING_MEET_LINK = prev;
    }
  });
});
