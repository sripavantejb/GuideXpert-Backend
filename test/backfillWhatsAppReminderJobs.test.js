'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs,
  mergeEnsureStats,
  emptyStats
} = require('../scripts/backfillWhatsAppReminderJobs');

describe('backfillWhatsAppReminderJobs', () => {
  test('parseArgs defaults to dry-run', () => {
    const p = parseArgs(['node', 'script.js']);
    assert.equal(p.execute, false);
    assert.ok(p.batchSize >= 1);
  });

  test('parseArgs --execute and batch-size', () => {
    const p = parseArgs(['node', 'script.js', '--execute', '--batch-size=250']);
    assert.equal(p.execute, true);
    assert.equal(p.batchSize, 250);
  });

  test('H: second merge on idempotent ensure adds no created', () => {
    const stats = emptyStats('EXECUTE');
    mergeEnsureStats(stats, {
      jobs: [
        { messageKind: 'pre4hr', created: true, state: 'pending' },
        { messageKind: 'meet', created: true, state: 'pending' },
        { messageKind: '30min', created: true, state: 'pending' }
      ]
    });
    assert.equal(stats.created, 3);
    mergeEnsureStats(stats, {
      jobs: [
        { messageKind: 'pre4hr', created: false, rescheduled: false, state: 'pending' },
        { messageKind: 'meet', created: false, rescheduled: false, state: 'pending' },
        { messageKind: '30min', created: false, rescheduled: false, state: 'pending' }
      ]
    });
    assert.equal(stats.created, 3);
    assert.equal(stats.updated, 3);
  });

  test('emptyStats includes hardening counters', () => {
    const s = emptyStats('DRY-RUN');
    assert.equal(s.duplicatePrevented, 0);
    assert.equal(s.wouldCreate, 0);
    assert.equal(s.expiredIgnored, 0);
  });
});
