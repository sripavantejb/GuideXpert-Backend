'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateEligibility,
  mapStageToPhase,
  isRecoveryOptOutText,
  deriveFlagsFromJourneyContext,
  nextScheduleAt,
} = require('../services/conversationRecovery/conversationRecoveryCore');
const {
  buildRecoveryMessage,
} = require('../services/conversationRecovery/conversationRecoveryMessageGenerator');
const { cloneJourneyBlob } = require('../services/conversationRecovery/conversationRecoverySnapshotService');

describe('conversationRecoveryCore', () => {
  test('maps stages to phases', () => {
    assert.equal(mapStageToPhase('personalized_recommendation'), 9);
    assert.equal(mapStageToPhase('booking_orchestrator'), 13);
  });

  test('eligibility requires inactivity and incomplete journey', () => {
    const cfg = {
      featureEnabled: true,
      intervalsHours: [24, 72, 168],
      maxAttempts: 3,
    };
    const now = new Date('2026-07-18T00:00:00Z');
    const snap = {
      journeyCompleted: false,
      bookingCompleted: false,
      optedOut: false,
      lastActivityAt: new Date('2026-07-16T00:00:00Z'),
    };
    assert.equal(evaluateEligibility(snap, null, cfg, now).eligible, true);
  });

  test('opt-out detection', () => {
    assert.equal(isRecoveryOptOutText('stop'), true);
    assert.equal(isRecoveryOptOutText('hello'), false);
  });

  test('schedule uses attempt interval', () => {
    const at = nextScheduleAt(new Date('2026-07-17T00:00:00Z'), 1, {
      intervalsHours: [24, 72, 168],
    });
    assert.equal(at.toISOString(), '2026-07-18T00:00:00.000Z');
  });

  test('derive flags from journey context', () => {
    assert.equal(
      deriveFlagsFromJourneyContext({
        profile: { phase13UrlShared: true },
      }).bookingCompleted,
      true
    );
  });
});

describe('conversationRecoveryMessageGenerator', () => {
  test('never includes booking URLs', () => {
    const msg = buildRecoveryMessage({ lastPhase: 13, studentName: 'Riya' });
    assert.doesNotMatch(msg, /http/i);
    assert.match(msg, /Riya/);
  });
});

describe('conversationRecoverySnapshotService', () => {
  test('cloneJourneyBlob deep-copies', () => {
    const src = { a: { b: 1 } };
    const out = cloneJourneyBlob(src);
    out.a.b = 2;
    assert.equal(src.a.b, 1);
  });
});
