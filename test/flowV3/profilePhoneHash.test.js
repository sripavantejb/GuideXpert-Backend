'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const phoneHash = require('../../services/chatbot/flowV3LLM/profile/flowV3PhoneHash');

const PHONE = '9876543210';
const PEPPER = 'test-pepper-value';

let savedPepper;

describe('flowV3 phone hashing', () => {
  before(() => {
    savedPepper = process.env[phoneHash.PHONE_HASH_PEPPER_ENV_VAR];
    delete process.env[phoneHash.PHONE_HASH_PEPPER_ENV_VAR];
  });

  after(() => {
    if (savedPepper === undefined) delete process.env[phoneHash.PHONE_HASH_PEPPER_ENV_VAR];
    else process.env[phoneHash.PHONE_HASH_PEPPER_ENV_VAR] = savedPepper;
  });

  test('is sha256(phone + pepper)', () => {
    const expected = crypto.createHash('sha256').update(`${PHONE}${PEPPER}`).digest('hex');
    const result = phoneHash.hashPhone(PHONE, { pepper: PEPPER });
    assert.equal(result.ok, true);
    assert.equal(result.hash, expected);
    assert.equal(phoneHash.isPhoneHash(result.hash), true);
  });

  test('reads the pepper from the environment when not injected', () => {
    process.env[phoneHash.PHONE_HASH_PEPPER_ENV_VAR] = PEPPER;
    try {
      const fromEnv = phoneHash.hashPhone(PHONE);
      assert.equal(fromEnv.ok, true);
      assert.equal(fromEnv.hash, phoneHash.hashPhone(PHONE, { pepper: PEPPER }).hash);
      assert.equal(phoneHash.isPepperConfigured(), true);
    } finally {
      delete process.env[phoneHash.PHONE_HASH_PEPPER_ENV_VAR];
    }
  });

  test('a missing pepper returns a config error and NO hash', () => {
    const result = phoneHash.hashPhone(PHONE);
    assert.equal(result.ok, false);
    assert.equal(result.hash, undefined);
    assert.equal(result.error.code, phoneHash.PHONE_HASH_ERRORS.PEPPER_MISSING);
    assert.match(result.error.todo, /TODO\(decision\)/);
    assert.equal(phoneHash.isPepperConfigured(), false);
  });

  test('a blank pepper is treated as missing, not as an empty string pepper', () => {
    const result = phoneHash.hashPhone(PHONE, { pepper: '   ' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, phoneHash.PHONE_HASH_ERRORS.PEPPER_MISSING);
  });

  test('never falls back to an unpeppered digest', () => {
    const unpeppered = crypto.createHash('sha256').update(PHONE).digest('hex');
    const result = phoneHash.hashPhone(PHONE);
    assert.equal(result.ok, false);
    assert.notEqual(JSON.stringify(result), JSON.stringify({ ok: true, hash: unpeppered }));
    assert.throws(() => phoneHash.hashPhoneOrThrow(PHONE), (err) => {
      assert.equal(err.name, 'FlowV3PhoneHashError');
      assert.equal(err.code, phoneHash.PHONE_HASH_ERRORS.PEPPER_MISSING);
      return true;
    });
  });

  test('a different pepper produces a different hash', () => {
    const a = phoneHash.hashPhone(PHONE, { pepper: 'pepper-a' }).hash;
    const b = phoneHash.hashPhone(PHONE, { pepper: 'pepper-b' }).hash;
    assert.notEqual(a, b);
  });

  test('a non-10-digit phone is a validation error', () => {
    for (const bad of ['+919876543210', '98765', '', null, undefined, {}]) {
      const result = phoneHash.hashPhone(bad, { pepper: PEPPER });
      assert.equal(result.ok, false, `${String(bad)} should not hash`);
      assert.equal(result.error.code, phoneHash.PHONE_HASH_ERRORS.INVALID_PHONE);
    }
  });

  test('is deterministic for the same input', () => {
    const first = phoneHash.hashPhoneOrThrow(PHONE, { pepper: PEPPER });
    const second = phoneHash.hashPhoneOrThrow(' 9876543210 ', { pepper: PEPPER });
    assert.equal(first, second);
  });
});
