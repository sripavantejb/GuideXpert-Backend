#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const {
  resolveIitCounsellingStrategySessionAwareLanguage,
} = require('../services/chatbot/conversationLanguageService');
const { answer: answerStrategy } = require('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyService');
const { answer: answerIce } = require('../services/chatbot/iitCounsellingExpert/iitCounsellingExpertService');
const { ICE_EMPTY_FALLBACK } = require('../services/chatbot/iitCounsellingExpert/iitCounsellingGuardrailService');
const { ICS_EMPTY_FALLBACK } = require('../services/chatbot/iitCounsellingStrategy/iitCounsellingStrategyGuardrailService');
const {
  CPA_EMPTY_FALLBACK,
} = require('../services/chatbot/counsellorProgram/counsellorProgramGuardrailService');

const CPA_FALLBACK_MARKERS = [CPA_EMPTY_FALLBACK, 'counselling program', 'GuideXpert program'];

function isBadReply(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (value === ICE_EMPTY_FALLBACK || value === ICS_EMPTY_FALLBACK) return true;
  if (CPA_FALLBACK_MARKERS.some((marker) => value.includes(marker))) return true;
  return false;
}

function strategyBotState() {
  return { state: 'idle', context: { iitCounsellingStrategyActive: true } };
}

function cpaBotState() {
  return { state: 'idle', context: { counsellorProgramAssistantActive: true } };
}

function iceBotState() {
  return { state: 'idle', context: { iitCounsellingExpertActive: true } };
}

function assertIntent(message, expected, botState = null, label = message) {
  const result = classifyIntent(message, botState, 'unknown', message);
  if (result.intent !== expected) {
    return { ok: false, label, detail: `intent ${result.intent} (reason ${result.intentReason})` };
  }
  return { ok: true, label };
}

async function assertStrategyAnswer(message, label = message) {
  const result = await answerStrategy({ inboundText: message, conversationId: null });
  if (isBadReply(result?.text)) {
    return { ok: false, label, detail: `bad reply: ${String(result?.text || '').slice(0, 80)}` };
  }
  return { ok: true, label };
}

async function assertIceAnswer(message, label = message) {
  const result = await answerIce({ inboundText: message, conversationId: null });
  if (isBadReply(result?.text)) {
    return { ok: false, label, detail: `bad reply: ${String(result?.text || '').slice(0, 80)}` };
  }
  return { ok: true, label };
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
  if (!String(process.env.LLM_API_KEY || '').trim()) {
    console.error('Set LLM_API_KEY for answer verification');
    process.exit(1);
  }

  const failures = [];

  function record(result) {
    if (result.ok) {
      console.log(`OK ${result.label}`);
    } else {
      failures.push(result);
      console.log(`FAIL ${result.label}: ${result.detail}`);
    }
  }

  console.log('=== Branch Strategy ===');
  let state = null;
  for (const message of ['CSE vs ECE?', 'Which has better placements?', 'What if I like coding?']) {
    record(assertIntent(message, 'iit_counselling_strategy', state));
    state = strategyBotState();
    record(await assertStrategyAnswer(message));
  }

  console.log('\n=== Float / Freeze Strategy ===');
  state = null;
  for (const message of [
    'When should I use float?',
    'When should I freeze?',
    'Should I use slide?',
  ]) {
    record(assertIntent(message, 'iit_counselling_strategy', state));
    state = strategyBotState();
    record(await assertStrategyAnswer(message));
  }

  console.log('\n=== Factual ICE Delegation ===');
  for (const message of ['What is float?', 'What is OBC-NCL rank?', 'What is home state quota?']) {
    record(assertIntent(message, 'iit_counselling_expert'));
    record(await assertIceAnswer(message));
  }

  console.log('\n=== Language Switching ===');
  const hiResolved = resolveIitCounsellingStrategySessionAwareLanguage({
    conversation: {},
    leadContext: {},
    detected: { language: 'hi', confidence: 0.9 },
    message: 'CSE ya ECE?',
    sessionLanguage: 'en',
  });
  record({
    ok: hiResolved.language === 'hi',
    label: 'Hindi opener resolves to hi',
    detail: `got ${hiResolved.language}`,
  });

  const teResolved = resolveIitCounsellingStrategySessionAwareLanguage({
    conversation: {},
    leadContext: {},
    detected: { language: 'te', confidence: 0.9 },
    message: 'CSE leda ECE?',
    sessionLanguage: 'hi',
  });
  record({
    ok: teResolved.language === 'te',
    label: 'Telugu switch from Hindi session',
    detail: `got ${teResolved.language}`,
  });

  for (const message of ['CSE ya ECE?', 'Coding pasand ho to?', 'CSE leda ECE?', 'Coding nachite?']) {
    record(assertIntent(message, 'iit_counselling_strategy'));
  }

  console.log('\n=== Session Priority ===');
  record(assertIntent('What is GuideXpert?', 'counsellor_program_assistant'));
  record(
    assertIntent('CSE vs ECE?', 'iit_counselling_strategy', cpaBotState(), 'CPA session -> CSE vs ECE')
  );
  record(assertIntent('What is JoSAA?', 'iit_counselling_expert'));
  record(
    assertIntent(
      'When should I use float?',
      'iit_counselling_strategy',
      iceBotState(),
      'ICE session -> When should I use float?'
    )
  );

  console.log('\n=== Reliability (3x float) ===');
  let floatSuccesses = 0;
  for (let i = 1; i <= 3; i += 1) {
    const result = await answerStrategy({ inboundText: 'When should I use float?', conversationId: null });
    if (!isBadReply(result?.text)) {
      floatSuccesses += 1;
      console.log(`OK float attempt ${i}/3`);
    } else {
      failures.push({ ok: false, label: `float attempt ${i}/3`, detail: 'bad reply' });
      console.log(`FAIL float attempt ${i}/3`);
    }
  }
  record({
    ok: floatSuccesses === 3,
    label: '3/3 float reliability',
    detail: `${floatSuccesses}/3`,
  });

  console.log('\n--- Summary ---');
  if (failures.length) {
    console.log(`Failures: ${failures.length}`);
    process.exit(1);
  }

  console.log('PHASE 8.2.1 VERIFICATION OK (automated local)');
  console.log('Production /api/health must show iitCounsellingStrategy before WhatsApp sign-off.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
