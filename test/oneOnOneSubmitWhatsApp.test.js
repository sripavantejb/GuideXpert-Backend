'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { getTemplateMetaForKind } = require('../utils/whatsappTemplateMeta');
const { validateMessageKindForOpsProduct } = require('../utils/whatsappOpsEventMatch');
const { sendFnForKind } = require('../services/whatsappRetryOrchestrator');

describe('one_on_one_submit ops wiring', () => {
  test('template meta maps one_on_one_submit env key', () => {
    assert.equal(getTemplateMetaForKind('one_on_one_submit').templateIdEnvKey, 'GUPSHUP_TEMPLATE_ONE_ON_ONE_CONFIRM');
  });

  test('ops product validation allows one_on_one_submit only on 1-on-1 product', () => {
    assert.equal(validateMessageKindForOpsProduct('one_on_one_submit', 'one_on_one_counseling'), null);
    assert.match(
      String(validateMessageKindForOpsProduct('one_on_one_submit', 'guidexpert') || ''),
      /not for GuideXpert/i
    );
    assert.match(
      String(validateMessageKindForOpsProduct('slot_booked', 'one_on_one_counseling') || ''),
      /not for 1-on-1/i
    );
  });

  test('retry orchestrator exposes send fn for one_on_one_submit', () => {
    assert.equal(typeof sendFnForKind('one_on_one_submit'), 'function');
  });
});
