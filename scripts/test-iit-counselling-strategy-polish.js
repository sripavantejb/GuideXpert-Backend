#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const {
  resolveIitCounsellingStrategySessionAwareLanguage,
} = require('../services/chatbot/conversationLanguageService');
const { answer } = require('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyService');
const { ICE_EMPTY_FALLBACK } = require('../services/chatbot/iitCounsellingExpert/iitCounsellingGuardrailService');
const { ICS_EMPTY_FALLBACK } = require('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyGuardrailService');

const VERIFICATION_MESSAGES = [
  'CSE vs ECE?',
  'Which has better placements?',
  'What if I like coding?',
  'When should I use float?',
  'When should I freeze?',
  'CSE leda ECE?',
  'Coding nachite?',
];

function isBadFallback(text) {
  const value = String(text || '').trim();
  return !value || value === ICE_EMPTY_FALLBACK || value === ICS_EMPTY_FALLBACK;
}

async function main() {
  if (String(process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED || '').trim() !== '1') {
    console.error('Set CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED=1');
    process.exit(1);
  }
  if (String(process.env.CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED || '').trim() !== '1') {
    console.error('Set CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED=1');
    process.exit(1);
  }

  let failures = 0;
  const cpaBotState = { state: 'idle', context: { counsellorProgramAssistantActive: true } };
  const iceBotState = { state: 'idle', context: { iitCounsellingExpertActive: true } };

  console.log('--- Session priority ---');
  for (const message of ['CSE vs ECE?', 'When should I use float?', 'Should I use slide?']) {
    for (const [label, botState] of [
      ['CPA session', cpaBotState],
      ['ICE session', iceBotState],
    ]) {
      const intent = classifyIntent(message, botState, 'unknown', message);
      if (intent.intent !== 'iit_counselling_strategy') {
        failures += 1;
        console.log(`FAIL [${label}] "${message}" -> ${intent.intent}`);
      } else {
        console.log(`OK [${label}] "${message}"`);
      }
    }
  }

  console.log('\n--- Language switch hi -> te ---');
  const teResolved = resolveIitCounsellingStrategySessionAwareLanguage({
    conversation: {},
    leadContext: {},
    detected: { language: 'te', confidence: 0.9 },
    message: 'CSE leda ECE?',
    sessionLanguage: 'hi',
  });
  if (teResolved.language !== 'te') {
    failures += 1;
    console.log(`FAIL language switch: ${teResolved.language}`);
  } else {
    console.log('OK language switch to Telugu');
  }

  console.log('\n--- Strategy answers ---');
  let botState = null;
  const hasLlm = Boolean(String(process.env.LLM_API_KEY || '').trim());

  for (const message of VERIFICATION_MESSAGES) {
    const intent = classifyIntent(message, botState, 'unknown', message);
    if (intent.intent !== 'iit_counselling_strategy') {
      failures += 1;
      console.log(`FAIL intent "${message}" -> ${intent.intent}`);
      continue;
    }
    botState = { state: 'idle', context: { iitCounsellingStrategyActive: true } };

    if (!hasLlm) {
      console.log(`OK intent "${message}" (skip answer — no LLM_API_KEY)`);
      continue;
    }

    const result = await answer({ inboundText: message, conversationId: null });
    if (isBadFallback(result?.text)) {
      failures += 1;
      console.log(`FAIL answer "${message}"`);
    } else {
      console.log(`OK answer "${message}"`);
    }
  }

  if (failures) {
    console.log(`\nPolish verification failures: ${failures}`);
    process.exit(1);
  }

  console.log('\nPHASE 8.2.1 POLISH OK (local verification)');
  console.log('Confirm on production WhatsApp screenshots before final sign-off.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
