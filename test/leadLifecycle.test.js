'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LIFECYCLE_STAGES,
  rankStage,
  maxStage,
  stageAtOrAbove,
  IIT_CALL_CONNECTED,
} = require('../constants/leadLifecycle');
const {
  buildLifecycleEvent,
  buildDedupeKey,
  inferPreviousStage,
} = require('../services/analytics/leadLifecycleEventBuilder');
const {
  findHistoryTransition,
  resolveIitQualified,
} = require('../services/analytics/iitLifecycleTransitionResolver');
const { pct, medianMs } = require('../services/analytics/leadLifecycleQueryUtils');
const { isSlotBooked, buildRegistrationEvents } = require('../services/analytics/leadLifecycleBackfillService');

describe('leadLifecycle constants', () => {
  test('stages are ordered', () => {
    assert.equal(LIFECYCLE_STAGES[0], 'lead');
    assert.equal(LIFECYCLE_STAGES[LIFECYCLE_STAGES.length - 1], 'admission');
    assert.ok(rankStage('booked') > rankStage('qualified'));
  });

  test('maxStage picks highest', () => {
    assert.equal(maxStage(['lead', 'booked', 'qualified']), 'booked');
  });

  test('stageAtOrAbove', () => {
    assert.equal(stageAtOrAbove('attended', 'booked'), true);
    assert.equal(stageAtOrAbove('interested', 'booked'), false);
  });
});

describe('leadLifecycleEventBuilder', () => {
  test('builds event with meta flags', () => {
    const id = '507f1f77bcf86cd799439011';
    const at = new Date('2026-01-15T10:00:00.000Z');
    const doc = buildLifecycleEvent({
      phone10: '9876543210',
      productLine: 'registration',
      stage: 'qualified',
      previousStage: 'lead',
      sourceCollection: 'FormSubmission',
      sourceId: id,
      transitionAt: at,
      meta: { inferred: true, proxyField: 'updatedAt', confidence: 'medium' },
    });
    assert.ok(doc);
    assert.equal(doc.phone10, '9876543210');
    assert.equal(doc.meta.inferred, true);
    assert.equal(doc.meta.proxyField, 'updatedAt');
    assert.equal(doc.meta.confidence, 'medium');
    assert.equal(doc.dedupeKey, buildDedupeKey({ productLine: 'registration', sourceId: id, stage: 'qualified' }));
  });

  test('rejects invalid phone', () => {
    const doc = buildLifecycleEvent({
      phone10: '123',
      productLine: 'registration',
      stage: 'lead',
      sourceCollection: 'FormSubmission',
      sourceId: '507f1f77bcf86cd799439011',
      transitionAt: new Date(),
    });
    assert.equal(doc, null);
  });

  test('inferPreviousStage', () => {
    assert.equal(inferPreviousStage('qualified'), 'lead');
    assert.equal(inferPreviousStage('lead'), null);
  });
});

describe('iitLifecycleTransitionResolver', () => {
  test('findHistoryTransition detects first demo scheduled', () => {
    const hit = findHistoryTransition(
      [
        {
          createdAt: new Date('2026-01-01'),
          demoStatus: 'not_scheduled',
        },
        {
          createdAt: new Date('2026-01-02'),
          demoStatus: 'scheduled',
        },
      ],
      'demoStatus',
      ['scheduled', 'demo_scheduled']
    );
    assert.ok(hit);
    assert.equal(hit.confidence, 'medium');
    assert.equal(hit.inferred, true);
  });

  test('resolveIitQualified prefers activity log', () => {
    const resolved = resolveIitQualified(
      [
        {
          eventType: 'call_status',
          toValue: 'call_connected',
          createdAt: new Date('2026-02-01'),
        },
      ],
      [],
      'not_called',
      new Date('2026-03-01')
    );
    assert.ok(resolved);
    assert.equal(resolved.confidence, 'high');
    assert.ok(IIT_CALL_CONNECTED.includes('call_connected'));
  });
});

describe('leadLifecycleFunnelService helpers', () => {
  test('pct and medianMs', () => {
    assert.equal(pct(25, 100), 25);
    assert.equal(medianMs([1000, 3000, 2000]), 2000);
    assert.equal(medianMs([]), null);
  });
});

describe('leadLifecycleBackfillService registration', () => {
  test('isSlotBooked detects booked leads', () => {
    assert.equal(isSlotBooked({ isRegistered: true }), true);
    assert.equal(isSlotBooked({ step3Data: { selectedSlot: 'MONDAY_7PM' } }), true);
    assert.equal(isSlotBooked({ currentStep: 2 }), false);
  });

  test('buildRegistrationEvents emits lead and qualified', () => {
    const events = [];
    const id = '507f1f77bcf86cd799439011';
    buildRegistrationEvents(
      {
        _id: id,
        phone: '9876543210',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        step2Data: { otpVerified: true, step2CompletedAt: new Date('2026-01-02') },
      },
      new Map(),
      events
    );
    assert.equal(events.length, 2);
    assert.equal(events[0].stage, 'lead');
    assert.equal(events[1].stage, 'qualified');
    assert.equal(events[1].meta.confidence, 'high');
  });
});
