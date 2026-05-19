const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyGupshupSendOutcome,
  isAmbiguousGupshupSendError
} = require('../utils/gupshupSendOutcome');

describe('gupshupSendOutcome', () => {
  test('isAmbiguousGupshupSendError detects timeout', () => {
    assert.equal(isAmbiguousGupshupSendError('timeout of 60000ms exceeded'), true);
    assert.equal(isAmbiguousGupshupSendError('invalid number'), false);
  });

  test('parses id from failed body as accepted', () => {
    const id = '59f8db90-c37e-4408-90ab-cc54ef8246ad';
    const r = classifyGupshupSendOutcome(
      { success: false, error: 'HTTP 500', data: { messageId: id } },
      { retryKind: 'slot_booked', outboundProduct: 'iit_counselling', templateIdEnvKey: 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY' }
    );
    assert.equal(r.treatAsAccepted, true);
    assert.equal(r.messageId, id);
    assert.equal(r.useAwaitingReconcile, false);
  });

  test('IIT ambiguous timeout uses awaiting reconcile', () => {
    const r = classifyGupshupSendOutcome(
      { success: false, error: 'timeout of 60000ms exceeded', data: null },
      { retryKind: 'slot_booked', outboundProduct: 'iit_counselling', templateIdEnvKey: 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY' }
    );
    assert.equal(r.treatAsAccepted, true);
    assert.equal(r.useAwaitingReconcile, true);
  });

  test('GuideXpert non-IIT hard failure stays failed path', () => {
    const r = classifyGupshupSendOutcome(
      { success: false, error: 'invalid number not whatsapp', data: null },
      { retryKind: 'slot_booked', outboundProduct: 'guidexpert', templateIdEnvKey: 'GUPSHUP_TEMPLATE_REMINDER' }
    );
    assert.equal(r.treatAsAccepted, false);
  });
});
