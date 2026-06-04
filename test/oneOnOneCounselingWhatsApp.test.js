'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOneOnOneSubmitVars,
  resolveOneOnOneHeaderImageUrl,
  parsePreferredSlotInstantUtc,
  GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL,
} = require('../utils/oneOnOneCounselingWhatsApp');

describe('oneOnOneCounselingWhatsApp', () => {
  const snapshot = {};

  beforeEach(() => {
    snapshot[GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL] = process.env[GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL];
    delete process.env[GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL];
  });

  afterEach(() => {
    if (snapshot[GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL] === undefined) {
      delete process.env[GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL];
    } else {
      process.env[GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL] = snapshot[GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL];
    }
  });

  test('buildOneOnOneSubmitVars uses student name', () => {
    assert.deepEqual(buildOneOnOneSubmitVars({ studentName: '  Priya  ' }), {
      name: 'Priya',
      Name: 'Priya',
    });
  });

  test('buildOneOnOneSubmitVars falls back to Student', () => {
    assert.deepEqual(buildOneOnOneSubmitVars({}), { name: 'Student', Name: 'Student' });
  });

  test('resolveOneOnOneHeaderImageUrl returns null when unset', () => {
    assert.equal(resolveOneOnOneHeaderImageUrl(), null);
  });

  test('resolveOneOnOneHeaderImageUrl trims configured URL', () => {
    process.env[GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL] = '  https://cdn.example/header.png  ';
    assert.equal(resolveOneOnOneHeaderImageUrl(), 'https://cdn.example/header.png');
  });

  test('parsePreferredSlotInstantUtc parses slot date and hour from label', () => {
    const d = parsePreferredSlotInstantUtc({
      preferredTimeSlotDate: '2026-06-05',
      preferredTimeSlot: 'Friday 6PM slot_18',
    });
    assert.ok(d instanceof Date);
    assert.equal(d.getUTCHours(), 12);
    assert.equal(d.getUTCMinutes(), 30);
  });

  test('parsePreferredSlotInstantUtc returns null for invalid date', () => {
    assert.equal(parsePreferredSlotInstantUtc({ preferredTimeSlotDate: 'bad' }), null);
  });
});
