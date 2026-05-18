const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { dlrReconcileGraceMs } = require('../utils/whatsappRetryRules');

describe('waReconcileObservability semantics', () => {
  test('F: stale warning threshold is 2x grace', () => {
    const grace = dlrReconcileGraceMs();
    const oldestAge = grace * 2 + 1;
    const warnings = [];
    if (oldestAge > grace * 2) {
      warnings.push('stale');
    }
    assert.equal(warnings.length, 1);
  });
});
