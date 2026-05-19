const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePrivilegedPhone,
  getPrivilegedPhone,
  getPrivilegedOtp,
  isPrivilegedPhone,
} = require('../utils/privilegedAccess');

describe('privilegedAccess', () => {
  it('normalizes +91 numbers to 10 digits', () => {
    assert.equal(normalizePrivilegedPhone('+91 81432 66699'), '8143266699');
  });

  it('detects privileged phone', () => {
    assert.equal(isPrivilegedPhone('8143266699'), true);
    assert.equal(isPrivilegedPhone('9999999999'), false);
  });

  it('returns fixed OTP', () => {
    assert.equal(getPrivilegedOtp(), '123456');
    assert.match(getPrivilegedPhone(), /^\d{10}$/);
  });
});
