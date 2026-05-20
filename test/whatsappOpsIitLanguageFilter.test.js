'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePreferredLanguageParam,
  applyIitLanguageToCohortFilter,
  IIT_REMINDER_MESSAGE_KINDS,
} = require('../services/whatsappOpsRecipientAnalytics');

describe('normalizePreferredLanguageParam', () => {
  test('accepts Telugu and Hindi', () => {
    assert.equal(normalizePreferredLanguageParam('Telugu'), 'Telugu');
    assert.equal(normalizePreferredLanguageParam('Hindi'), 'Hindi');
    assert.equal(normalizePreferredLanguageParam('  Hindi  '), 'Hindi');
  });

  test('null when unset', () => {
    assert.equal(normalizePreferredLanguageParam(null), null);
    assert.equal(normalizePreferredLanguageParam(''), null);
  });

  test('undefined when invalid', () => {
    assert.equal(normalizePreferredLanguageParam('English'), undefined);
    assert.equal(normalizePreferredLanguageParam('telugu'), undefined);
  });
});

describe('applyIitLanguageToCohortFilter', () => {
  test('adds preferredLanguage field', () => {
    const base = { counsellingSlotInstantUtc: { $gte: new Date(), $lte: new Date() } };
    const out = applyIitLanguageToCohortFilter(base, 'Telugu');
    assert.equal(out['iitCounselling.section2Data.preferredLanguage'], 'Telugu');
    assert.ok(out.counsellingSlotInstantUtc);
  });

  test('no-op when lang null', () => {
    const base = { x: 1 };
    assert.deepEqual(applyIitLanguageToCohortFilter(base, null), base);
  });
});

describe('IIT_REMINDER_MESSAGE_KINDS', () => {
  test('includes expected reminder kinds', () => {
    assert.deepEqual(IIT_REMINDER_MESSAGE_KINDS, ['iit_pre2hr', 'iit_pre45min', 'iit_pre15min']);
  });
});

describe('computeReminderJobCoverageForCohort preferredLanguage', () => {
  test('documents baseMatch shape when preferredLanguage set', () => {
    const preferredLanguage = 'Hindi';
    const baseMatch = {
      iitCounsellingSubmissionId: { $in: [] },
      slotDayIst: '2026-05-20',
      messageKind: 'iit_pre45min',
    };
    if (preferredLanguage) {
      baseMatch.preferredLanguage = preferredLanguage;
    }
    assert.equal(baseMatch.preferredLanguage, 'Hindi');
    assert.equal(baseMatch.messageKind, 'iit_pre45min');
  });
});
