'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateMessageKindForOpsProduct,
  IIT_ONLY_KINDS,
  GX_ONLY_KINDS,
} = require('../utils/whatsappOpsEventMatch');

describe('whatsappOpsEventMatch', () => {
  test('validateMessageKindForOpsProduct allows IIT kinds on IIT product', () => {
    for (const kind of IIT_ONLY_KINDS) {
      assert.equal(validateMessageKindForOpsProduct(kind, 'iit_counselling'), null);
    }
    assert.equal(validateMessageKindForOpsProduct('slot_booked', 'iit_counselling'), null);
  });

  test('validateMessageKindForOpsProduct rejects GX kinds on IIT product', () => {
    for (const kind of GX_ONLY_KINDS) {
      assert.match(
        validateMessageKindForOpsProduct(kind, 'iit_counselling'),
        /IIT Counselling/
      );
    }
  });

  test('validateMessageKindForOpsProduct rejects IIT kinds on GuideXpert product', () => {
    assert.match(
      validateMessageKindForOpsProduct('iit_pre45min', 'guidexpert'),
      /GuideXpert/
    );
  });

  test('iit_pre45min + opsProduct=iit_counselling passes kind guard; invalid combos rejected', () => {
    assert.equal(validateMessageKindForOpsProduct('iit_pre45min', 'iit_counselling'), null);
    assert.match(
      validateMessageKindForOpsProduct('iit_pre45min', 'guidexpert'),
      /GuideXpert/
    );
    assert.match(
      validateMessageKindForOpsProduct('pre4hr', 'iit_counselling'),
      /IIT Counselling/
    );
  });

  test('validateMessageKindForOpsProduct guidance booking product', () => {
    assert.equal(validateMessageKindForOpsProduct('guidance_booking_submit', 'guidance_booking'), null);
    assert.match(
      validateMessageKindForOpsProduct('guidance_booking_submit', 'guidexpert'),
      /GuideXpert/
    );
    assert.match(
      validateMessageKindForOpsProduct('one_on_one_submit', 'guidance_booking'),
      /Guidance Booking/
    );
  });
});
