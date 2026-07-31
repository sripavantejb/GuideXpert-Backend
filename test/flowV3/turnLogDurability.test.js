'use strict';

/**
 * F-3 + F-9 regression — turn-log durability and the silent-failure sweep.
 *
 * F-3: the turn log must actually write. The incident pattern was a floating
 * `writeTurnLog(...).catch(() => {})` killed by the serverless freeze, with
 * the {ok:false} result discarded. These tests prove: failures are logged
 * loudly; the waitUntil path defers without dropping; the await path completes
 * before the dispatcher returns; a dead DB fails fast and visibly.
 *
 * F-9: every previously-silent failure path now logs and degrades visibly.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { flushTurnLog } = require('../../services/chatbot/flowV3LLM/log/flushTurnLog');
const { writeTurnLog } = require('../../services/chatbot/flowV3LLM/log/turnLog');
const { processFlowV3Turn } = require('../../services/chatbot/flowV3LLM/flowV3Dispatcher');
const { runLlmLoop } = require('../../services/chatbot/flowV3LLM/llm/llmLoop');
const { runFallbackLadder } = require('../../services/chatbot/flowV3LLM/validate/fallbackLadder');
const { updateRollingSummary } = require('../../services/chatbot/flowV3LLM/context/rollingSummary');
const { listAvailableVersions } = require('../../services/chatbot/flowV3LLM/llm/promptLoader');

function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  const restore = () => {
    console.error = original;
  };
  return Promise.resolve()
    .then(() => fn(lines))
    .finally(restore)
    .then(() => lines);
}

function okModel() {
  const state = { created: [] };
  return {
    state,
    db: { readyState: 1 },
    async create(doc) {
      state.created.push(doc);
      return doc;
    },
  };
}

function envelopeProvider() {
  return {
    async chatCompletion() {
      return {
        text: JSON.stringify({
          intent: 'ask_slot',
          parts: [{ type: 'text', body: 'What is your preferred city?' }],
          grounding: [],
          profile_patch: {},
          booking_url_slot: null,
        }),
        toolCalls: null,
        finishReason: 'stop',
      };
    },
  };
}

describe('F-3: turn log durability', () => {
  test('a write failure is logged loudly, never swallowed', async () => {
    const failing = {
      db: { readyState: 1 },
      async create() {
        throw new Error('disk full');
      },
    };
    const lines = await captureErrors(async () => {
      const res = await flushTurnLog(
        { turnId: 't1', conversationId: 'c1' },
        { FlowV3TurnLog: failing, waitUntil: null }
      );
      assert.equal(res.ok, false);
    });
    assert.ok(
      lines.some((l) => l.includes('TURNLOG_WRITE_FAILED')),
      `expected TURNLOG_WRITE_FAILED in ${JSON.stringify(lines)}`
    );
  });

  test('waitUntil path: flush returns before the insert, and the registered promise lands the write', async () => {
    let resolveCreate;
    const gate = new Promise((r) => {
      resolveCreate = r;
    });
    const model = {
      db: { readyState: 1 },
      created: [],
      async create(doc) {
        await gate; // insert intentionally slower than the response
        this.created.push(doc);
        return doc;
      },
    };
    const registered = [];
    const fakeWaitUntil = (p) => registered.push(p);

    const res = await flushTurnLog(
      { turnId: 't2', conversationId: 'c2' },
      { FlowV3TurnLog: model, waitUntil: fakeWaitUntil }
    );
    // The "response" moment: flush already returned, insert NOT yet done.
    assert.equal(res.deferred, true);
    assert.equal(model.created.length, 0, 'insert should still be in flight');
    assert.equal(registered.length, 1, 'write must be registered with waitUntil');

    // The runtime honors waitUntil: the container survives until this settles.
    resolveCreate();
    await registered[0];
    assert.equal(model.created.length, 1, 'write must land under waitUntil');
  });

  test('await path: the dispatcher completes the write before returning', async () => {
    const model = okModel();
    await processFlowV3Turn({
      text: 'hello',
      conversationId: 'c3',
      profile: {},
      mode: 'shadow',
      provider: envelopeProvider(),
      deps: { FlowV3TurnLog: model, waitUntil: null },
    });
    assert.equal(model.state.created.length, 1, 'turn log must be written when the turn returns');
    assert.equal(model.state.created[0].conversationId, 'c3');
  });

  test('gate-terminated turns also land a turn log', async () => {
    const model = okModel();
    await processFlowV3Turn({
      text: 'male',
      conversationId: 'c4',
      profile: { examType: 'AP_EAMCET', category: 'OC' },
      mode: 'shadow',
      provider: {
        async chatCompletion() {
          throw new Error('never');
        },
      },
      deps: { FlowV3TurnLog: model, waitUntil: null },
    });
    assert.equal(model.state.created.length, 1);
    assert.equal(model.state.created[0].blocked, true);
  });

  test('a dead DB fails fast and visibly instead of buffering', async () => {
    const res = await writeTurnLog(
      { turnId: 't5', conversationId: 'c5' },
      { FlowV3TurnLog: { db: { readyState: 0 }, create: async () => ({}) } }
    );
    assert.equal(res.ok, false);
    assert.ok(String(res.error).startsWith('db_not_connected'));
  });
});

describe('F-9: silent failures now fail closed and visibly', () => {
  test('malformed tool args: tool NOT executed, failure logged and fed back', async () => {
    let brokerCalled = 0;
    let calls = 0;
    const provider = {
      async chatCompletion() {
        calls += 1;
        if (calls === 1) {
          return {
            text: '',
            toolCalls: [
              { id: 'tc1', type: 'function', function: { name: 'next_question', arguments: '{broken' } },
            ],
            finishReason: 'tool_calls',
          };
        }
        return {
          text: JSON.stringify({
            intent: 'answer_question',
            parts: [{ type: 'text', body: 'Let me rephrase that.' }],
            grounding: [],
            profile_patch: {},
            booking_url_slot: null,
          }),
          toolCalls: null,
          finishReason: 'stop',
        };
      },
    };
    let out;
    const lines = await captureErrors(async () => {
      out = await runLlmLoop({
        messages: [{ role: 'user', content: 'hi' }],
        provider,
        broker: {
          async invokeTool() {
            brokerCalled += 1;
            return { ok: true, result: {}, callId: 'x' };
          },
        },
        wallMs: 8000,
      });
    });
    assert.equal(brokerCalled, 0, 'tool must never run with guessed args');
    assert.ok(lines.some((l) => l.includes('TOOL_ARGS_PARSE_FAILED')));
    const failedTrace = out.toolTrace.find((t) => t.error === 'malformed_tool_args');
    assert.ok(failedTrace, 'trace must record the malformed call');
    assert.ok(
      out.messages.some(
        (m) => m.role === 'tool' && String(m.content).includes('malformed_tool_args')
      ),
      'the model must be told the tool call failed'
    );
  });

  test('fallback ladder: slot engine failure is logged and surfaced, not a silent downgrade', async () => {
    const explodingSlotMeta = new Proxy(
      {},
      {
        get() {
          throw new Error('slot meta store corrupted');
        },
      }
    );
    let out;
    const lines = await captureErrors(async () => {
      out = runFallbackLadder({ profile: {}, slotMeta: explodingSlotMeta, reason: 'llm_failed' });
    });
    assert.equal(out.tier, 'B');
    assert.ok(out.slotError, 'slotError must be surfaced on the result');
    assert.ok(lines.some((l) => l.includes('FALLBACK_SLOT_ENGINE_FAILED')));
  });

  test('rolling summary: generator failure is logged, extractive fallback still used', async () => {
    let out;
    const lines = await captureErrors(async () => {
      out = await updateRollingSummary(
        { summary: null, summaryTurnCount: 0, turnCount: 3 },
        [{ role: 'student', text: 'I want CSE with good placements' }],
        {
          generate: async () => {
            throw new Error('provider down');
          },
        }
      );
    });
    assert.equal(out.source, 'extractive');
    assert.ok(out.summary.includes('CSE'));
    assert.ok(lines.some((l) => l.includes('SUMMARY_GENERATOR_FAILED')));
  });

  test('prompt loader: unreadable prompts dir is logged loudly', async () => {
    let versions;
    const lines = await captureErrors(async () => {
      versions = listAvailableVersions('/nonexistent/prompts/dir');
    });
    assert.deepEqual(versions, []);
    assert.ok(lines.some((l) => l.includes('PROMPT_DIR_UNREADABLE')));
  });
});
