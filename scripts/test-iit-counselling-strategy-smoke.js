#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { answer } = require('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyService');
const { ICS_EMPTY_FALLBACK } = require('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyGuardrailService');

const SMOKE_MATRIX = [
  { label: 'Branch discussion', messages: ['CSE vs ECE?', 'Which branch is better?', 'What if I like coding?'] },
  { label: 'College discussion', messages: ['IIT or NIT?', 'Which should I prefer?'] },
  { label: 'JoSAA strategy', messages: ['When should I use float?', 'When should I freeze?'] },
  { label: 'Branch vs college', messages: ['Should I prioritize branch or college?'] },
  { label: 'ICE regression', messages: ['What is OBC-NCL rank?'], expectIntent: 'iit_counselling_expert' },
];

function isFallback(text) {
  return String(text || '').trim() === ICS_EMPTY_FALLBACK;
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

  for (const scenario of SMOKE_MATRIX) {
    console.log(`\n=== ${scenario.label} ===`);
    let botState = null;

    for (const message of scenario.messages) {
      const intent = classifyIntent(message, botState, 'unknown', message);
      const expected = scenario.expectIntent || 'iit_counselling_strategy';

      if (intent.intent !== expected) {
        failures += 1;
        console.log(`FAIL intent: "${message}" -> ${intent.intent} (expected ${expected})`);
        continue;
      }

      if (expected === 'iit_counselling_strategy') {
        botState = { state: 'idle', context: { iitCounsellingStrategyActive: true } };
        if (!String(process.env.LLM_API_KEY || '').trim()) {
          console.log(`OK intent: "${message}" (LLM_API_KEY not set — skip answer check)`);
          continue;
        }
        const result = await answer({ inboundText: message, conversationId: null });
        if (!result?.text || isFallback(result.text)) {
          failures += 1;
          console.log(`FAIL answer: "${message}"`);
        } else {
          console.log(`OK: "${message}"`);
        }
      } else {
        console.log(`OK ICE regression intent: "${message}"`);
      }
    }
  }

  if (failures) {
    console.log(`\nSmoke failures: ${failures}`);
    process.exit(1);
  }

  console.log('\nPHASE 8.2 SMOKE OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
