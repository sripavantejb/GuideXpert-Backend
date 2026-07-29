'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  compactWhatsAppSpacing,
} = require('../services/chatbot/guidedFlows/guidedFlowOrchestrator');

test('compactWhatsAppSpacing removes blank and edge gaps while preserving line breaks', () => {
  assert.equal(
    compactWhatsAppSpacing('\n\nGreat! 👍\n\nBefore I recommend colleges.\n\n\nNext line.\n'),
    'Great! 👍\nBefore I recommend colleges.\nNext line.'
  );
});
