const { test } = require('node:test');
const assert = require('node:assert/strict');

test('clearWhatsAppChatbotLead module loads', () => {
  const mod = require('../services/chatbot/clearChatbotLeadService');
  assert.equal(typeof mod.clearWhatsAppChatbotLead, 'function');
});
