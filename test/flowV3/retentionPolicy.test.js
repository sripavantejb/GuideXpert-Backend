'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const constants = require('../../constants/flowV3/flowV3Retention');
const retention = require('../../services/chatbot/flowV3LLM/profile/flowV3RetentionPolicy');
const { emptyFlowV3Profile } = require('../../constants/flowV3/flowV3LeadProfileSchema');

const NOW = new Date('2026-07-30T00:00:00.000Z');

function docWithLastSeen(monthsAgo, profileOverrides = {}) {
  const lastSeenAt = new Date(NOW.getTime() - monthsAgo * constants.MONTHS_TO_MS);
  return {
    phone: '9876543210',
    profile: { ...emptyFlowV3Profile(), lastSeenAt, ...profileOverrides },
    updatedAt: lastSeenAt,
  };
}

describe('retention policy metadata (§3)', () => {
  test('Tier 1 is retained indefinitely', () => {
    assert.equal(constants.SENSITIVITY_TIERS[1].retention.mode, constants.RETENTION_MODES.INDEFINITE);
    assert.equal(retention.getFieldRetention('goal').action, retention.RETENTION_ACTIONS.RETAIN);
  });

  test('Tier 2 anonymises 24 months after lastSeenAt', () => {
    const policy = constants.SENSITIVITY_TIERS[2].retention;
    assert.equal(policy.mode, constants.RETENTION_MODES.ANONYMIZE_AFTER);
    assert.equal(policy.months, 24);
    assert.equal(policy.from, 'lastSeenAt');
    assert.equal(retention.getFieldRetention('name').action, retention.RETENTION_ACTIONS.ANONYMIZE);
  });

  test('Tier 3 is purpose-bound to cutoffs and the S-1 gate only', () => {
    assert.equal(constants.SENSITIVITY_TIERS[3].retention.mode, constants.RETENTION_MODES.PURPOSE_BOUND);
    assert.equal(retention.checkTier3Purpose('cutoff_computation').allowed, true);
    assert.equal(retention.checkTier3Purpose('s1_demographic_gate').allowed, true);

    const refused = retention.checkTier3Purpose('marketing_segmentation');
    assert.equal(refused.allowed, false);
    assert.equal(refused.reason, 'TIER3_PURPOSE_NOT_ALLOWED');
    assert.equal(constants.SENSITIVITY_TIERS[3].neverForSegmentation, true);
    assert.equal(constants.SENSITIVITY_TIERS[3].neverInferred, true);
  });

  test('Tier 4 purges after 6 months except crisis records', () => {
    const policy = constants.SENSITIVITY_TIERS[4].retention;
    assert.equal(policy.mode, constants.RETENTION_MODES.DELETE_AFTER);
    assert.equal(policy.months, 6);
    assert.equal(policy.exception, constants.RETENTION_MODES.EXISTING_CRISIS_POLICY);
    assert.equal(
      retention.getFieldRetention('crisisLocked').action,
      retention.RETENTION_ACTIONS.CRISIS_POLICY
    );
    assert.equal(
      retention.getFieldRetention('accessibilityNeeds').action,
      retention.RETENTION_ACTIONS.PURGE
    );
  });

  test('Tier 4 is excluded from every LLM prompt', () => {
    assert.equal(constants.SENSITIVITY_TIERS[4].inLlmPrompt, false);
    const excluded = retention.fieldsExcludedFromLlmPrompt();
    assert.ok(excluded.includes('accessibilityNeeds'));
    assert.ok(excluded.includes('crisisLocked'));
  });
});

describe('retention plans', () => {
  test('Tier 2 anonymisation is not due before 24 months', () => {
    const plan = retention.buildTier2AnonymizationPlan(docWithLastSeen(12), { now: NOW });
    assert.equal(plan.due, false);
    assert.ok(plan.dueAt > NOW);
  });

  test('Tier 2 anonymisation is due after 24 months and hashes the phone', () => {
    const plan = retention.buildTier2AnonymizationPlan(docWithLastSeen(25), { now: NOW });
    assert.equal(plan.due, true);
    assert.deepEqual(plan.hashFields, ['phone']);
    assert.ok(plan.dropFields.includes('name'));
    assert.ok(plan.dropFields.includes('schoolName'));
    assert.equal(plan.requiresPepperedPhoneHash, true);
    assert.equal(plan.retainedFields.includes('name'), false);
    assert.ok(plan.retainedFields.includes('city'), 'non-identifying Tier 2 context is retained');
  });

  test('Tier 4 purge exempts crisis records', () => {
    const plan = retention.buildTier4PurgePlan(docWithLastSeen(7), { now: NOW });
    assert.equal(plan.due, true);
    assert.ok(plan.purgeFields.includes('accessibilityNeeds'));
    assert.equal(plan.purgeFields.includes('crisisLocked'), false);
    assert.ok(plan.exemptFields.includes('crisisLocked'));
    assert.ok(plan.exemptFields.includes('crisisHandoffId'));
    assert.equal(plan.exemptReason, constants.RETENTION_MODES.EXISTING_CRISIS_POLICY);
  });

  test('a document with no lastSeenAt yields no due date rather than purging immediately', () => {
    const plan = retention.buildTier4PurgePlan({ phone: '9876543210', profile: {} }, { now: NOW });
    assert.equal(plan.lastSeenAt, null);
    assert.equal(plan.dueAt, null);
    assert.equal(plan.due, false);
  });

  test('lastSeenAt falls back to updatedAt', () => {
    const updatedAt = new Date(NOW.getTime() - constants.MONTHS_TO_MS);
    assert.equal(retention.resolveLastSeenAt({ profile: {}, updatedAt }).getTime(), updatedAt.getTime());
  });

  test('evaluateRetention reports all four tiers and is pure', () => {
    const doc = docWithLastSeen(25);
    const snapshot = JSON.stringify(doc);

    const plan = retention.evaluateRetention(doc, { now: NOW });

    assert.equal(JSON.stringify(doc), snapshot, 'evaluateRetention must not mutate the document');
    assert.equal(plan.tier1.action, retention.RETENTION_ACTIONS.RETAIN);
    assert.equal(plan.tier2.due, true);
    assert.equal(plan.tier3.action, retention.RETENTION_ACTIONS.PURPOSE_BOUND);
    assert.deepEqual(plan.tier3.nestedPaths, ['examResults.category', 'examResults.gender']);
    assert.equal(plan.tier4.due, true);
  });
});

describe('retention implementation boundaries', () => {
  test('no scheduler and no TTL are implemented by this milestone', () => {
    const plan = retention.evaluateRetention(docWithLastSeen(30), { now: NOW });
    assert.equal(plan.ttlIndexUsed, false);
    assert.equal(plan.schedulerImplemented, false);
    assert.equal(constants.TTL_INDEXES_FORBIDDEN, true);
  });

  test('the module exposes no delete, purge or schedule executor', () => {
    const exported = Object.keys(retention);
    for (const name of exported) {
      assert.equal(
        /^(delete|purge|anonymize|schedule|run|execute)/.test(name),
        false,
        `${name} looks like an executor — retention must stay plan-only`
      );
    }
  });
});
