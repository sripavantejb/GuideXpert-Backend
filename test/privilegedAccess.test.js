const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePrivilegedPhone,
  getPrivilegedPhones,
  getPrivilegedOtp,
  isPrivilegedPhone,
} = require('../utils/privilegedAccess');

describe('privilegedAccess', () => {
  it('normalizes +91 numbers to 10 digits', () => {
    assert.equal(normalizePrivilegedPhone('+91 81432 66699'), '8143266699');
    assert.equal(normalizePrivilegedPhone('+91 63041 53659'), '6304153659');
  });

  it('detects privileged phones', () => {
    assert.equal(isPrivilegedPhone('8143266699'), true);
    assert.equal(isPrivilegedPhone('6304153659'), true);
    assert.equal(isPrivilegedPhone('9999999999'), false);
  });

  it('returns fixed OTP and default phone list', () => {
    assert.equal(getPrivilegedOtp(), '123456');
    const phones = getPrivilegedPhones();
    assert.ok(phones.includes('8143266699'));
    assert.ok(phones.includes('6304153659'));
  });
});
