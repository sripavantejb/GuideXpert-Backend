'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { determineRoute } = require('../services/chatbot/handoffService');

describe('handoff routing', () => {
  test('admin_pool when no IIT lead', async () => {
    const route = await determineRoute({
      phone: '9876543210',
      hasIit: false,
      iit: null,
    });
    assert.equal(route.route, 'admin_pool');
    assert.equal(route.assignedBdaId, null);
  });
});
