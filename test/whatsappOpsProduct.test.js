'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseOpsProductQuery,
  matchWhatsAppEventsByOpsProduct,
  effectiveOverviewMessageKind,
  GUIDEXPERT_EVENT_MATCH_FRAGMENT
} = require('../utils/whatsappOpsProduct');

describe('whatsappOpsProduct', () => {
  test('parseOpsProductQuery normalizes IIT aliases', () => {
    assert.equal(parseOpsProductQuery(''), 'guidexpert');
    assert.equal(parseOpsProductQuery('iit_counselling'), 'iit_counselling');
    assert.equal(parseOpsProductQuery('IIT-COUNSELLING'), 'iit_counselling');
    assert.equal(parseOpsProductQuery(undefined), 'guidexpert');
    assert.equal(parseOpsProductQuery('junk'), 'guidexpert');
  });

  test('matchWhatsAppEventsByOpsProduct IT branch forces slug', () => {
    assert.deepEqual(matchWhatsAppEventsByOpsProduct('iit_counselling'), { opsProduct: 'iit_counselling' });
  });

  test('matchWhatsAppEventsByOpsProduct GuideXpert includes legacy omission', () => {
    assert.equal(matchWhatsAppEventsByOpsProduct('guidexpert').$or.length, GUIDEXPERT_EVENT_MATCH_FRAGMENT.$or.length);
    assert(matchWhatsAppEventsByOpsProduct('guidexpert').$or);
  });

  test('effectiveOverviewMessageKind passes through explicit kind only', () => {
    assert.equal(effectiveOverviewMessageKind('iit_counselling', null), null);
    assert.equal(effectiveOverviewMessageKind('iit_counselling', 'pre4hr'), 'pre4hr');
    assert.equal(effectiveOverviewMessageKind('guidexpert', null), null);
  });
});
