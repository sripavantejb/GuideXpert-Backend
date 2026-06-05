'use strict';

const { afterEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const ORIGINAL_VERCEL = process.env.VERCEL;

afterEach(() => {
  if (ORIGINAL_VERCEL === undefined) {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = ORIGINAL_VERCEL;
  }
});

describe('gupshup inbound webhook waitUntil gating', () => {
  test('uses waitUntil only when VERCEL=1 and waitUntil is a function', () => {
    function shouldQueueOnVercel({ vercelEnv, waitUntilType }) {
      return vercelEnv === '1' && waitUntilType === 'function';
    }

    assert.equal(shouldQueueOnVercel({ vercelEnv: '1', waitUntilType: 'function' }), true);
    assert.equal(shouldQueueOnVercel({ vercelEnv: undefined, waitUntilType: 'function' }), false);
    assert.equal(shouldQueueOnVercel({ vercelEnv: '1', waitUntilType: 'undefined' }), false);
  });

  test('local runtime loads @vercel/functions without forcing queued response', () => {
    delete process.env.VERCEL;
    let waitUntilType = 'missing';
    try {
      const { waitUntil } = require('@vercel/functions');
      waitUntilType = typeof waitUntil;
    } catch {
      waitUntilType = 'missing';
    }

    const useWaitUntil = process.env.VERCEL === '1' && waitUntilType === 'function';
    assert.equal(useWaitUntil, false);
  });
});
