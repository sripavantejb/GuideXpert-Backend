'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('internal smoke endpoint gates', () => {
  let prevEnv;

  before(() => {
    prevEnv = {
      NODE_ENV: process.env.NODE_ENV,
      INTERNAL_SMOKE_TEST_SECRET: process.env.INTERNAL_SMOKE_TEST_SECRET,
    };
  });

  after(() => {
    if (prevEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv.NODE_ENV;
    if (prevEnv.INTERNAL_SMOKE_TEST_SECRET === undefined) {
      delete process.env.INTERNAL_SMOKE_TEST_SECRET;
    } else {
      process.env.INTERNAL_SMOKE_TEST_SECRET = prevEnv.INTERNAL_SMOKE_TEST_SECRET;
    }
    // Clear cached modules that read env at call time (our util reads at call time — OK)
  });

  it('is disabled when secret missing even in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.INTERNAL_SMOKE_TEST_SECRET;
    const {
      isInternalSmokeEndpointEnabled,
      isValidInternalSmokeSecret,
    } = require('../utils/internalSmokeSecret');
    assert.equal(isInternalSmokeEndpointEnabled(), false);
    assert.equal(isValidInternalSmokeSecret('anything'), false);
  });

  it('is disabled when NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'development';
    process.env.INTERNAL_SMOKE_TEST_SECRET = 'test-secret-value-123456';
    const { isInternalSmokeEndpointEnabled } = require('../utils/internalSmokeSecret');
    assert.equal(isInternalSmokeEndpointEnabled(), false);
  });

  it('accepts only the configured secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.INTERNAL_SMOKE_TEST_SECRET = 'test-secret-value-123456';
    const {
      isInternalSmokeEndpointEnabled,
      isValidInternalSmokeSecret,
      extractInternalSmokeCredential,
    } = require('../utils/internalSmokeSecret');
    assert.equal(isInternalSmokeEndpointEnabled(), true);
    assert.equal(isValidInternalSmokeSecret('test-secret-value-123456'), true);
    assert.equal(isValidInternalSmokeSecret('wrong'), false);
    const req = {
      headers: { 'x-internal-smoke-secret': 'test-secret-value-123456' },
      query: {},
      body: {},
    };
    assert.equal(extractInternalSmokeCredential(req), 'test-secret-value-123456');
  });

  it('middleware rejects non-production with 404', () => {
    process.env.NODE_ENV = 'development';
    process.env.INTERNAL_SMOKE_TEST_SECRET = 'test-secret-value-123456';
    const { requireInternalSmoke } = require('../middleware/requireInternalSmoke');
    let status = null;
    let body = null;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };
    requireInternalSmoke({ headers: {}, body: {}, query: {}, originalUrl: '/api/internal/smoke/send', method: 'POST' }, res, () => {
      assert.fail('next should not be called');
    });
    assert.equal(status, 404);
    assert.equal(body.success, false);
  });

  it('middleware rejects missing credential with 401 in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.INTERNAL_SMOKE_TEST_SECRET = 'test-secret-value-123456';
    // Fresh require not needed — reads env at request time
    delete require.cache[require.resolve('../middleware/requireInternalSmoke')];
    const { requireInternalSmoke } = require('../middleware/requireInternalSmoke');
    let status = null;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
    };
    requireInternalSmoke(
      {
        headers: {},
        body: { phone: '9347763131', message: 'hi' },
        query: {},
        originalUrl: '/api/internal/smoke/send',
        method: 'POST',
      },
      res,
      () => assert.fail('next should not be called')
    );
    assert.equal(status, 401);
  });
});
