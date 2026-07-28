'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  FOLLOWUP_STEPS,
  startBookingFollowups,
  nextDueFollowup,
  markFollowupSent,
} = require('../services/chatbot/flowV2/bookingFollowupService');
const { mergeFlowV2Profile } = require('../services/chatbot/flowV2/flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

describe('bookingFollowupService', () => {
  test('schedules three company follow-up steps', () => {
    assert.equal(FOLLOWUP_STEPS.length, 3);
    assert.equal(FOLLOWUP_STEPS[0].delayMs, 30 * 60 * 1000);
    assert.equal(FOLLOWUP_STEPS[1].delayMs, 60 * 60 * 1000);
    assert.equal(FOLLOWUP_STEPS[2].delayMs, 3 * 60 * 60 * 1000);
  });

  test('fires +30m then +1h then +3h in order', () => {
    const declinedAt = new Date('2026-07-28T10:00:00.000Z');
    let profile = mergeFlowV2Profile(emptyFlowV2Profile(), startBookingFollowups(declinedAt));

    assert.equal(nextDueFollowup(profile, new Date('2026-07-28T10:10:00.000Z')), null);

    let step = nextDueFollowup(profile, new Date('2026-07-28T10:31:00.000Z'));
    assert.equal(step.level, 1);
    profile = markFollowupSent(profile, 1);

    step = nextDueFollowup(profile, new Date('2026-07-28T10:50:00.000Z'));
    assert.equal(step, null);

    step = nextDueFollowup(profile, new Date('2026-07-28T11:01:00.000Z'));
    assert.equal(step.level, 2);
    profile = markFollowupSent(profile, 2);

    step = nextDueFollowup(profile, new Date('2026-07-28T13:01:00.000Z'));
    assert.equal(step.level, 3);
    profile = markFollowupSent(profile, 3);

    assert.equal(nextDueFollowup(profile, new Date('2026-07-28T20:00:00.000Z')), null);
    assert.equal(profile.followupsSent, 3);
  });
});
