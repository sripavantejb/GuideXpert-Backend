#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { answer } = require('../services/chatbot/iitCounsellingExpert/iitCounsellingExpertService');
const { ICE_EMPTY_FALLBACK } = require('../services/chatbot/iitCounsellingExpert/iitCounsellingGuardrailService');

const QUESTIONS = [
  'What is OBC-NCL rank?',
  'What is CRL rank?',
  'What is home state quota?',
  'What is float?',
  'What is slide?',
  'What is CSAB?',
];

const RUNS_PER_QUESTION = Number(process.env.ICE_RELIABILITY_RUNS || 10);

function isFallbackReply(text) {
  const value = String(text || '').trim();
  return !value || value === ICE_EMPTY_FALLBACK;
}

async function runQuestion(question, runs) {
  let successes = 0;
  let fallbacks = 0;
  const failures = [];

  for (let attempt = 1; attempt <= runs; attempt += 1) {
    const result = await answer({
      inboundText: question,
      conversationId: null,
      leadContext: null,
    });

    if (!result || isFallbackReply(result.text)) {
      fallbacks += 1;
      failures.push({
        attempt,
        text: result?.text || null,
        guardrailReason: result?.guardrailReason || null,
        answerSource: result?.languageLog?.answerSource || null,
      });
    } else {
      successes += 1;
    }
  }

  return { question, successes, fallbacks, failures, runs };
}

async function main() {
  if (String(process.env.CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED || '').trim() !== '1') {
    console.error('Set CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED=1 before running reliability tests.');
    process.exit(1);
  }
  if (!String(process.env.LLM_API_KEY || '').trim()) {
    console.error('Set LLM_API_KEY before running reliability tests.');
    process.exit(1);
  }

  const summary = [];
  for (const question of QUESTIONS) {
    const result = await runQuestion(question, RUNS_PER_QUESTION);
    summary.push(result);
    console.log(
      `${question}: ${result.successes}/${result.runs} successful, ${result.fallbacks} fallback replies`
    );
    if (result.failures.length) {
      console.log('Failures:', JSON.stringify(result.failures, null, 2));
    }
  }

  const totalRuns = summary.reduce((sum, entry) => sum + entry.runs, 0);
  const totalSuccesses = summary.reduce((sum, entry) => sum + entry.successes, 0);
  const totalFallbacks = summary.reduce((sum, entry) => sum + entry.fallbacks, 0);
  const allReliable = summary.every((entry) => entry.fallbacks === 0);

  console.log('\n--- Summary ---');
  console.log(`Total: ${totalSuccesses}/${totalRuns} successful, ${totalFallbacks} fallback replies`);

  if (allReliable) {
    console.log('\nPHASE 8.1 RELIABLE');
    process.exit(0);
  }

  console.log('\nPHASE 8.1 NOT RELIABLE — fix failures and re-run.');
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
