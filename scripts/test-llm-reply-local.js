#!/usr/bin/env node
/**
 * Smoke-test NVIDIA LLM via tryLlmReply (Phase 4 Sprint 1).
 * Usage: node scripts/test-llm-reply-local.js
 *
 * Requires in .env:
 *   CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED=1
 *   LLM_API_KEY=...
 *   LLM_BASE_URL=https://integrate.api.nvidia.com/v1
 *   LLM_MODEL=openai/gpt-oss-20b
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { tryLlmReply } = require('../services/chatbot/llmReplyService');

function preflight() {
  const missing = [];
  if (String(process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED || '').trim() !== '1') {
    missing.push('CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED=1');
  }
  if (!String(process.env.LLM_API_KEY || '').trim()) {
    missing.push('LLM_API_KEY');
  }
  if (!String(process.env.LLM_BASE_URL || '').trim()) {
    missing.push('LLM_BASE_URL');
  }
  if (!String(process.env.LLM_MODEL || '').trim()) {
    missing.push('LLM_MODEL');
  }
  if (missing.length) {
    console.error('FAIL: missing env:', missing.join(', '));
    process.exit(1);
  }
}

async function main() {
  preflight();
  console.log('Calling tryLlmReply({ inboundText: "Hello" }) ...');
  const result = await tryLlmReply({ inboundText: 'Hello' });
  console.log(result);
  if (!result?.text) {
    console.error('FAIL: expected non-empty result.text');
    process.exit(1);
  }
  console.log('OK: received reply, length=', result.text.length);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
