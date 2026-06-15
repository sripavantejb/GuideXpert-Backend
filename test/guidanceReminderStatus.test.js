'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  mapJobToReminderState,
  mapEventToReminderState,
  emptyReminderCounts,
  incrementReminderCounts,
  incrementEventCounts,
} = require('../services/guidanceReminderStatusService');

describe('guidanceReminderStatusService', () => {
  test('mapJobToReminderState maps lifecycle states', () => {
    const now = new Date('2026-06-13T10:00:00.000Z');

    assert.equal(mapJobToReminderState({ state: 'delivered' }, now), 'delivered');
    assert.equal(mapJobToReminderState({ state: 'read' }, now), 'read');
    assert.equal(mapJobToReminderState({ state: 'failed' }, now), 'failed');
    assert.equal(mapJobToReminderState({ state: 'skipped' }, now), 'skipped');
    assert.equal(mapJobToReminderState({ state: 'dispatched' }, now), 'sent');
    assert.equal(mapJobToReminderState({ state: 'reconcile_pending' }, now), 'sent');
    assert.equal(mapJobToReminderState(null, now), 'none');
  });

  test('mapJobToReminderState marks overdue pending jobs', () => {
    const now = new Date('2026-06-13T10:00:00.000Z');
    const overdueJob = {
      state: 'pending',
      scheduledSendAt: new Date('2026-06-13T09:00:00.000Z'),
    };
    assert.equal(mapJobToReminderState(overdueJob, now), 'overdue');
  });

  test('incrementReminderCounts aggregates by bucket', () => {
    const now = new Date('2026-06-13T10:00:00.000Z');
    const counts = emptyReminderCounts();

    incrementReminderCounts(counts, { state: 'pending', scheduledSendAt: new Date('2026-06-13T11:00:00.000Z') }, now);
    incrementReminderCounts(counts, { state: 'delivered' }, now);
    incrementReminderCounts(counts, { state: 'skipped' }, now);
    incrementReminderCounts(
      counts,
      { state: 'pending', scheduledSendAt: new Date('2026-06-13T09:00:00.000Z') },
      now
    );

    assert.deepEqual(counts, {
      scheduled: 4,
      pending: 1,
      delivered: 1,
      read: 0,
      failed: 0,
      skipped: 1,
      overdue: 1,
    });
  });

  test('mapEventToReminderState maps WhatsApp message event statuses', () => {
    assert.equal(mapEventToReminderState({ status: 'delivered' }), 'delivered');
    assert.equal(mapEventToReminderState({ status: 'read' }), 'read');
    assert.equal(mapEventToReminderState({ status: 'failed' }), 'failed');
    assert.equal(mapEventToReminderState({ status: 'retry_exhausted' }), 'failed');
    assert.equal(mapEventToReminderState({ status: 'retry_pending' }), 'pending');
    assert.equal(mapEventToReminderState({ status: 'submitted' }), 'sent');
    assert.equal(mapEventToReminderState(null), 'none');
  });

  test('incrementEventCounts aggregates counsellor notify events', () => {
    const counts = emptyReminderCounts();
    incrementEventCounts(counts, { status: 'submitted' });
    incrementEventCounts(counts, { status: 'delivered' });
    incrementEventCounts(counts, { status: 'failed' });

    assert.deepEqual(counts, {
      scheduled: 3,
      pending: 0,
      delivered: 1,
      read: 0,
      failed: 1,
      skipped: 0,
      overdue: 0,
    });
  });
});
