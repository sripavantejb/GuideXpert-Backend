'use strict';

/**
 * A-4 — while flowV3MinorPolicy is unwired, consent / isMinor must have no
 * reachable write path. resolveIsMinor is kept ready for when consent copy
 * lands; nothing may call it or persist those fields today.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  canLlmWriteField,
  SYSTEM_WRITE_BLOCKED_FIELDS,
  isSystemWriteBlockedField,
} = require('../../constants/flowV3/flowV3LeadProfileSchema');
const {
  isWritableByChannel,
  validateProfilePatch,
  WRITE_POLICY_CODES,
} = require('../../services/chatbot/flowV3LLM/profile/flowV3ProfileWritePolicy');
const { WRITE_CHANNELS } = require('../../constants/flowV3/flowV3ProfileEnums');

const ROOT = path.join(__dirname, '../..');
const FLOW_V3_LLM = path.join(ROOT, 'services/chatbot/flowV3LLM');
const BLOCKED = ['consentAt', 'consentVersion', 'isMinor'];

function walkJs(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(full, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('minor / consent write-path guard (policy unwired)', () => {
  test('SYSTEM_WRITE_BLOCKED_FIELDS covers consentAt, consentVersion, isMinor', () => {
    for (const field of BLOCKED) {
      assert.ok(SYSTEM_WRITE_BLOCKED_FIELDS.includes(field), field);
      assert.equal(isSystemWriteBlockedField(field), true, field);
      assert.equal(canLlmWriteField(field).allowed, false, field);
    }
  });

  test('every write channel refuses consentAt / consentVersion / isMinor', () => {
    for (const field of BLOCKED) {
      for (const channel of WRITE_CHANNELS) {
        const gate = isWritableByChannel(field, channel);
        assert.equal(gate.allowed, false, `${field} on ${channel}`);
        assert.equal(gate.code, WRITE_POLICY_CODES.SYSTEM_BLOCKED, `${field} on ${channel}`);
      }
    }
  });

  test('validateProfilePatch drops consent / isMinor on every channel', () => {
    const patch = {
      consentAt: new Date('2026-01-01T00:00:00.000Z'),
      consentVersion: 'v1',
      isMinor: false,
    };
    const meta = {
      consentAt: { source: 'system' },
      consentVersion: { source: 'system' },
      isMinor: { source: 'system' },
    };
    for (const channel of WRITE_CHANNELS) {
      const result = validateProfilePatch({
        patch,
        meta,
        channel,
        turnId: 'a4-minor-guard',
      });
      assert.deepEqual(result.accepted, {}, channel);
      assert.equal(result.rejected.length, 3, channel);
      for (const rejection of result.rejected) {
        assert.equal(rejection.code, WRITE_POLICY_CODES.SYSTEM_BLOCKED, rejection.field);
      }
    }
  });

  test('no production flowV3LLM module calls resolveIsMinor while unwired', () => {
    const files = walkJs(FLOW_V3_LLM).filter(
      (f) => path.basename(f) !== 'flowV3MinorPolicy.js'
    );
    const callHits = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (/\bresolveIsMinor\s*\(/.test(src)) {
        callHits.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(callHits, [], `resolveIsMinor called from:\n${callHits.join('\n')}`);
  });
});
