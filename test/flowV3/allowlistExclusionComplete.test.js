'use strict';

/**
 * A-2 — the derived allowlist IS the safety surface.
 *
 * Enumerate the full exclusion set from schema data (not a hardcoded sample of
 * five examples). Snapshot the writable set so any future widening/narrowing
 * fails loudly. The load-time IIFE in flowV3LeadProfileSchema remains the
 * first line of defence; this suite is the regression net.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = require('../../constants/flowV3/flowV3LeadProfileSchema');

const writableFixture = require('./fixtures/llmWritableFields.json');
const blockedFixture = require('./fixtures/llmBlockedFields.json');

describe('LLM write allowlist — complete exclusion set', () => {
  test('every LLM_BLOCKED_FIELDS member is denied by canLlmWriteField', () => {
    assert.ok(schema.LLM_BLOCKED_FIELDS.length > 20, 'exclusion set must be data-derived and non-trivial');
    for (const field of schema.LLM_BLOCKED_FIELDS) {
      const gate = schema.canLlmWriteField(field);
      assert.equal(
        gate.allowed,
        false,
        `expected canLlmWriteField('${field}') === false, got ${JSON.stringify(gate)}`
      );
    }
  });

  test('every LLM_BLOCKED_NESTED_PATHS member is denied', () => {
    for (const fieldPath of schema.LLM_BLOCKED_NESTED_PATHS) {
      const gate = schema.canLlmWriteField(fieldPath);
      assert.equal(gate.allowed, false, `nested path ${fieldPath} must be denied`);
    }
    // Indexed forms under examResults must also be denied (suffix rule).
    assert.equal(schema.canLlmWriteField('examResults.0.category').allowed, false);
    assert.equal(schema.canLlmWriteField('examResults.0.gender').allowed, false);
  });

  test('every SYSTEM_WRITE_BLOCKED_FIELDS member is LLM-denied and system-blocked', () => {
    for (const field of schema.SYSTEM_WRITE_BLOCKED_FIELDS) {
      assert.equal(schema.canLlmWriteField(field).allowed, false, field);
      assert.equal(schema.isSystemWriteBlockedField(field), true, field);
    }
    for (const field of ['consentAt', 'consentVersion', 'isMinor']) {
      assert.ok(schema.SYSTEM_WRITE_BLOCKED_FIELDS.includes(field), `${field} must be system-blocked`);
    }
  });

  test('exclusion set includes every required group H / I / Tier 3 / Tier 4 field', () => {
    const blocked = new Set(schema.LLM_BLOCKED_FIELDS);
    for (const field of schema.LLM_BLOCKED_FIELDS) {
      const def = schema.getFieldDef(field);
      assert.ok(def, `blocked field ${field} must exist in schema`);
      const byGroup = ['H', 'I', 'J', 'K', 'SYS'].includes(def.group);
      const byTier = def.sens === 3 || def.sens === 4;
      const byFlag = def.llmWritable === false || def.systemWriteBlocked === true;
      assert.ok(
        byGroup || byTier || byFlag,
        `${field} is in LLM_BLOCKED_FIELDS without a group/tier/flag reason`
      );
    }
    // Named must-haves from the contract / A-1 prompt.
    for (const must of [
      'leadStage',
      'bookingStatus',
      'crisisLocked',
      'consentAt',
      'consentVersion',
      'isMinor',
      'category',
      'gender',
      'accessibilityNeeds',
    ]) {
      assert.ok(blocked.has(must), `exclusion set missing required field ${must}`);
    }
  });

  test('writable-set snapshot matches LLM_WRITABLE_FIELDS (fails loudly on drift)', () => {
    const live = [...schema.LLM_WRITABLE_FIELDS].sort();
    assert.deepEqual(
      live,
      [...writableFixture].sort(),
      'LLM writable surface drifted — update test/flowV3/fixtures/llmWritableFields.json deliberately'
    );
  });

  test('blocked-set snapshot matches schema exports (fails loudly on drift)', () => {
    assert.deepEqual(
      [...schema.LLM_BLOCKED_FIELDS].sort(),
      [...blockedFixture.LLM_BLOCKED_FIELDS].sort()
    );
    assert.deepEqual(
      [...schema.LLM_BLOCKED_NESTED_PATHS].sort(),
      [...blockedFixture.LLM_BLOCKED_NESTED_PATHS].sort()
    );
    assert.deepEqual(
      [...schema.SYSTEM_WRITE_BLOCKED_FIELDS].sort(),
      [...blockedFixture.SYSTEM_WRITE_BLOCKED_FIELDS].sort()
    );
  });

  test('every writable field is intentional: known, not blocked, canLlmWriteField true', () => {
    for (const field of schema.LLM_WRITABLE_FIELDS) {
      assert.equal(schema.isKnownField(field), true, field);
      assert.equal(schema.LLM_BLOCKED_FIELDS.includes(field), false, field);
      assert.equal(schema.canLlmWriteField(field).allowed, true, field);
      const def = schema.getFieldDef(field);
      assert.ok(!['H', 'I', 'J', 'K', 'SYS'].includes(def.group), `${field} group ${def.group}`);
      assert.ok(def.sens !== 3 && def.sens !== 4, `${field} tier ${def.sens}`);
    }
  });

  test('fixture files exist on disk next to this suite', () => {
    const dir = path.join(__dirname, 'fixtures');
    assert.ok(fs.existsSync(path.join(dir, 'llmWritableFields.json')));
    assert.ok(fs.existsSync(path.join(dir, 'llmBlockedFields.json')));
  });
});
