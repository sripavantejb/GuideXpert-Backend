'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseEnvelope } = require('../../services/chatbot/flowV3LLM/llm/parseEnvelope');
const { runLlmLoop } = require('../../services/chatbot/flowV3LLM/llm/llmLoop');
const { processFlowV3Turn } = require('../../services/chatbot/flowV3LLM/flowV3Dispatcher');
const { validateEnvelope } = require('../../services/chatbot/flowV3LLM/validate/validateEnvelope');
const { runFallbackLadder } = require('../../services/chatbot/flowV3LLM/validate/fallbackLadder');
const { renderEnvelope } = require('../../services/chatbot/flowV3LLM/render/renderEnvelope');

describe('parseEnvelope', () => {
  test('parses a valid JSON envelope', () => {
    const out = parseEnvelope(
      JSON.stringify({
        intent: 'ask_slot',
        parts: [{ type: 'text', body: 'What is your goal?' }],
        grounding: [],
        profile_patch: {},
        booking_url_slot: null,
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.envelope.intent, 'ask_slot');
  });

  test('rejects malformed JSON then reports V-1_PARSE', () => {
    const out = parseEnvelope('not json at all');
    assert.equal(out.ok, false);
    assert.ok(out.issues.includes('V-1_PARSE') || out.error);
  });
});

describe('llmLoop with mocked provider', () => {
  test('tool round-trip then JSON envelope', async () => {
    let calls = 0;
    const provider = {
      async chatCompletion({ tools }) {
        calls += 1;
        if (calls === 1 && tools) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'next_question', arguments: '{}' },
              },
            ],
            finishReason: 'tool_calls',
          };
        }
        return {
          text: JSON.stringify({
            intent: 'ask_slot',
            parts: [{ type: 'text', body: 'What matters most in a college for you?' }],
            grounding: [],
            profile_patch: {},
            booking_url_slot: null,
          }),
          toolCalls: null,
          finishReason: 'stop',
        };
      },
    };
    const broker = {
      async invokeTool(name) {
        return {
          callId: 'tq_1',
          ok: true,
          result: { slot: 'goal', askable: 'What is your goal?' },
          error: null,
        };
      },
    };
    const out = await runLlmLoop({
      messages: [
        { role: 'system', content: 'test' },
        { role: 'user', content: 'hi' },
      ],
      provider,
      broker,
      wallMs: 8000,
    });
    assert.equal(out.ok, true);
    assert.equal(out.envelope.intent, 'ask_slot');
    assert.equal(out.toolTrace.length, 1);
    assert.equal(out.toolTrace[0].name, 'next_question');
  });

  test('malformed JSON triggers repair then succeeds', async () => {
    let calls = 0;
    const provider = {
      async chatCompletion() {
        calls += 1;
        if (calls === 1) return { text: 'here is prose', toolCalls: null, finishReason: 'stop' };
        if (calls === 2) return { text: '{bad', toolCalls: null, finishReason: 'stop' };
        return {
          text: JSON.stringify({
            intent: 'answer_question',
            parts: [{ type: 'text', body: 'Happy to help with college questions.' }],
            grounding: [],
            profile_patch: {},
            booking_url_slot: null,
          }),
          toolCalls: null,
          finishReason: 'stop',
        };
      },
    };
    const out = await runLlmLoop({
      messages: [{ role: 'user', content: 'hi' }],
      provider,
      broker: { invokeTool: async () => ({ ok: true, result: {}, callId: 'x' }) },
      wallMs: 8000,
    });
    assert.equal(out.ok, true);
    assert.ok(calls >= 2);
  });
});

describe('dispatcher gates before LLM', () => {
  test('crisis terminates without calling the provider', async () => {
    let called = false;
    const provider = {
      async chatCompletion() {
        called = true;
        throw new Error('should not call LLM');
      },
    };
    const out = await processFlowV3Turn({
      text: 'i want to die, please help me end it',
      conversationId: 'conv_test_crisis',
      phone: '9876543210',
      profile: {},
      mode: 'shadow',
      provider,
    });
    assert.equal(called, false);
    assert.ok(out.gateResult);
    assert.equal(out.gateResult.passed, false);
    assert.equal(out.terminal?.kind || out.gateResult.terminal?.kind, 'crisis');
  });
});

describe('validate + fallback + render', () => {
  test('V-3 guarantee language blocks', () => {
    const out = validateEnvelope({
      intent: 'answer_question',
      parts: [{ type: 'text', body: 'We guarantee 100% placement package.' }],
      grounding: ['knowledge:1'],
      profile_patch: {},
      booking_url_slot: null,
    });
    assert.equal(out.ok, false);
    assert.ok(out.violations.some((v) => v.code === 'V-3'));
  });

  test('fallback ladder A asks next slot', () => {
    const out = runFallbackLadder({
      profile: {},
      slotMeta: {},
      reason: 'parse_failed',
    });
    assert.equal(out.tier, 'A');
    assert.ok(out.replyText);
  });

  test('render injects booking URL only from tool result', () => {
    const rendered = renderEnvelope(
      {
        intent: 'book',
        parts: [{ type: 'text', body: 'Here is your booking link:' }],
        grounding: [],
        profile_patch: {},
        booking_url_slot: 'one_on_one',
      },
      {
        toolTrace: [
          {
            name: 'create_booking_link',
            ok: true,
            result: { url: 'https://www.guidexpert.co.in/one-on-one-session' },
          },
        ],
      }
    );
    assert.ok(rendered.replyParts[0].includes('guidexpert.co.in'));
  });
});
