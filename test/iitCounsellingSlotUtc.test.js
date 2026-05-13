'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { computeIitCounsellingSlotInstantUtc } = require('../utils/iitCounsellingSlotUtc');

describe('iitCounsellingSlotUtc', () => {
  test('parses IST wall times via +05:30 offset string', () => {
    const wed = computeIitCounsellingSlotInstantUtc('Wednesday 6PM', '2026-05-13');
    assert.equal(wed.toISOString(), '2026-05-13T12:30:00.000Z');
    const sun = computeIitCounsellingSlotInstantUtc('Sunday 11AM', '2026-05-17');
    assert.equal(sun.toISOString(), '2026-05-17T05:30:00.000Z');
  });

  test('requires both slot label and calendar day', () => {
    assert.equal(computeIitCounsellingSlotInstantUtc('Wednesday 6PM', ''), null);
    assert.equal(computeIitCounsellingSlotInstantUtc('', '2026-05-13'), null);
  });
});
