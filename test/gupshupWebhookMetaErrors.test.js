'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { extractMetaStatusErrors } = require('../controllers/gupshupWebhookController');

const META_FAILED_SNIPPET = {
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            statuses: [
              {
                errors: [
                  {
                    code: 132012,
                    error_data: {
                      details: 'header: Format mismatch, expected IMAGE, received UNKNOWN',
                      messaging_product: 'whatsapp'
                    },
                    message: '(#132012) Parameter format does not match format in the created template',
                    type: 'OAuthException'
                  }
                ],
                gs_id: '0c29748b-83ce-4cf0-b811-b6854d444c14',
                status: 'failed'
              }
            ]
          }
        }
      ]
    }
  ]
};

describe('extractMetaStatusErrors', () => {
  test('extracts code and message from Meta WABA statuses[].errors[]', () => {
    const { failureCode, failureReason } = extractMetaStatusErrors(META_FAILED_SNIPPET);
    assert.equal(failureCode, '132012');
    assert.match(failureReason, /Parameter format does not match/);
  });

  test('returns nulls when no errors present', () => {
    const { failureCode, failureReason } = extractMetaStatusErrors({ entry: [] });
    assert.equal(failureCode, null);
    assert.equal(failureReason, null);
  });
});
