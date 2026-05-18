'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

describe('whatsappReminderJobAnalytics', () => {
  test('J: coverageGap = booked − scheduledJobs (fixture math)', () => {
    const booked = 10;
    const scheduledJobs = 10;
    const coverageGap = Math.max(0, booked - scheduledJobs);
    assert.equal(coverageGap, 0);
    assert.equal(booked, scheduledJobs);
  });

  test('J: non-zero gap when jobs missing', () => {
    const booked = 8;
    const scheduledJobs = 5;
    assert.equal(Math.max(0, booked - scheduledJobs), 3);
  });

  test('empty cohort returns full coverage gap', async () => {
    const { computeReminderJobCoverageForCohort } = require('../services/whatsappReminderJobAnalytics');
    const r = await computeReminderJobCoverageForCohort({
      cohortSubmissionIds: [],
      slotDayIst: '2026-08-15',
      messageKind: 'pre4hr'
    });
    assert.equal(r.booked, 0);
    assert.equal(r.scheduledJobs, 0);
    assert.equal(r.coverageGap, 0);
  });
});
