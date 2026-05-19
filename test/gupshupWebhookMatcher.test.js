const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { pickBestWebhookMatchCandidate } = require('../utils/gupshupWebhookMatcher');

describe('gupshupWebhookMatcher', () => {
  test('pickBestWebhookMatchCandidate prefers in-flight IIT row', () => {
    const gsId = '72f61f22-5aa4-4615-a970-943edf6da01c';
    const docs = [
      {
        _id: '1',
        status: 'delivered',
        opsProduct: 'guidexpert',
        gupshupMessageId: gsId,
        createdAt: new Date('2024-05-20T10:00:00Z')
      },
      {
        _id: '2',
        status: 'submitted',
        opsProduct: 'iit_counselling',
        gupshupMessageId: gsId,
        providerAcceptedAt: new Date('2024-05-20T12:00:00Z'),
        createdAt: new Date('2024-05-20T12:00:00Z')
      }
    ];
    const picked = pickBestWebhookMatchCandidate(docs);
    assert.equal(String(picked._id), '2');
  });

  test('pickBestWebhookMatchCandidate returns sole doc', () => {
    const doc = { _id: '9', status: 'queued', opsProduct: 'iit_counselling' };
    assert.equal(pickBestWebhookMatchCandidate([doc]), doc);
    assert.equal(pickBestWebhookMatchCandidate([]), null);
  });
});
