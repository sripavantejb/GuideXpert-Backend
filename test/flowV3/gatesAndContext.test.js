'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { runGateChain, GATE_VERDICTS } = require('../../services/chatbot/flowV3LLM/gates/gateChain');
const { evaluateDemographicGate } = require('../../services/chatbot/flowV3LLM/gates/demographicGate');
const { buildHistoryWindow } = require('../../services/chatbot/flowV3LLM/context/historyWindow');
const {
  shouldRegenerateSummary,
  buildExtractiveSummary,
  updateRollingSummary,
} = require('../../services/chatbot/flowV3LLM/context/rollingSummary');
const {
  loadPrompt,
  resolvePinnedVersion,
  latestVersion,
  clearPromptCache,
  PromptNotFoundError,
} = require('../../services/chatbot/flowV3LLM/llm/promptLoader');
const { buildTurnContext } = require('../../services/chatbot/flowV3LLM/context/buildTurnContext');

describe('gate chain order (safety property)', () => {
  test('crisis beats booking intent in the same message', () => {
    const out = runGateChain({ text: 'book a session, my life is over, i want to die' });
    assert.equal(out.passed, false);
    assert.equal(out.terminal.kind, 'crisis');
    assert.equal(out.terminal.handoffEager, true);
    assert.equal(out.verdicts[out.verdicts.length - 1].gate, 'G-CRISIS');
  });

  test('permanent crisis lock terminates before anything else runs', () => {
    const out = runGateChain({ text: 'hi', profile: { crisisLocked: true } });
    assert.equal(out.terminal.kind, 'crisis_locked');
    assert.equal(out.verdicts.length, 1);
  });

  test('opt-out is silence, not a reply', () => {
    const out = runGateChain({ text: 'hello', profile: { optedOut: true } });
    assert.equal(out.terminal.kind, 'silent');
    assert.equal(out.verdicts[out.verdicts.length - 1].verdict, GATE_VERDICTS.SILENT);
  });

  test('S-1 demographic block terminates with verbatim copy and no LLM', () => {
    const out = runGateChain({
      text: 'suggest colleges',
      profile: { examType: 'AP_EAMCET', category: 'OC', gender: 'male' },
    });
    assert.equal(out.passed, false);
    assert.equal(out.terminal.kind, 'demographic_blocked');
    assert.ok(out.terminal.copy && out.terminal.copy.length > 0);
  });

  test('lowercase exam aliases still trip the demographic gate', () => {
    const out = evaluateDemographicGate({ examType: 'ap eamcet', category: 'OC', gender: 'male' });
    assert.equal(out.blocked, true);
  });

  test('budget exhaustion routes to the fallback ladder', () => {
    const out = runGateChain({
      text: 'hi',
      budget: { llmCallsUsed: 3, maxLlmCalls: 3 },
    });
    assert.equal(out.terminal.kind, 'budget_exhausted');
  });

  test('clean turn passes every gate', () => {
    const out = runGateChain({ text: 'i want to study engineering', profile: {} });
    assert.equal(out.passed, true);
    assert.equal(out.terminal, null);
    assert.ok(out.verdicts.every((v) => v.verdict === GATE_VERDICTS.PASS));
  });
});

describe('history window', () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'bot',
    text: `turn ${i}`,
  }));

  test('keeps the newest N turns in order', () => {
    const out = buildHistoryWindow(turns, { windowTurns: 6 });
    assert.equal(out.entries.length, 6);
    assert.equal(out.entries[out.entries.length - 1].text, 'turn 19');
    assert.equal(out.droppedTurns, 14);
  });

  test('char budget trims the oldest, never the newest', () => {
    const out = buildHistoryWindow(turns, { windowTurns: 10, maxChars: 20 });
    assert.ok(out.entries.length < 10);
    assert.equal(out.entries[out.entries.length - 1].text, 'turn 19');
  });

  test('roles normalise to user/assistant', () => {
    const out = buildHistoryWindow([{ role: 'bot', text: 'hi' }]);
    assert.equal(out.entries[0].role, 'assistant');
  });
});

describe('rolling summary policy', () => {
  test('regenerates every 6 turns', () => {
    assert.equal(shouldRegenerateSummary({ summary: 's', turnCount: 6, summaryTurnCount: 0 }).shouldRegenerate, true);
    assert.equal(shouldRegenerateSummary({ summary: 's', turnCount: 5, summaryTurnCount: 0 }).shouldRegenerate, false);
    assert.equal(shouldRegenerateSummary({ summary: null, turnCount: 1 }).shouldRegenerate, true);
  });

  test('falls back to an extractive summary when generation fails', async () => {
    const turns = [{ role: 'user', text: 'i want cse in hyderabad' }];
    const out = await updateRollingSummary(
      { summary: null, turnCount: 1 },
      turns,
      { generate: async () => { throw new Error('provider down'); } }
    );
    assert.equal(out.regenerated, true);
    assert.equal(out.source, 'extractive');
    assert.ok(out.summary.includes('cse in hyderabad'));
  });

  test('uses the injected generator when it succeeds', async () => {
    const out = await updateRollingSummary(
      { summary: null, turnCount: 1 },
      [{ role: 'user', text: 'hi' }],
      { generate: async () => 'student wants CSE' }
    );
    assert.equal(out.source, 'generated');
    assert.equal(out.summary, 'student wants CSE');
  });

  test('extractive summary keeps only student turns', () => {
    const summary = buildExtractiveSummary([
      { role: 'user', text: 'my rank is 25000' },
      { role: 'bot', text: 'thanks!' },
    ]);
    assert.ok(summary.includes('25000'));
    assert.equal(summary.includes('thanks!'), false);
  });
});

describe('prompt loader', () => {
  test('missing prompt is a loud error, never invented copy', () => {
    clearPromptCache();
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowv3-prompt-'));
    assert.throws(() => loadPrompt('v1', { dir: emptyDir }), PromptNotFoundError);
    assert.equal(latestVersion(emptyDir), null);
  });

  test('pins a version and hashes content', () => {
    clearPromptCache();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowv3-prompt-'));
    fs.writeFileSync(path.join(dir, 'system_prompt.v1.md'), '# prompt one');
    fs.writeFileSync(path.join(dir, 'system_prompt.v2.md'), '# prompt two');

    assert.equal(resolvePinnedVersion(null, { dir }), 'v2');
    assert.equal(resolvePinnedVersion('v1', { dir }), 'v1');

    const v1 = loadPrompt('v1', { dir });
    const v2 = loadPrompt('v2', { dir });
    assert.equal(v1.version, 'v1');
    assert.notEqual(v1.hash, v2.hash);
    assert.equal(v1.hash.length, 16);
  });
});

describe('turn context', () => {
  test('assembles context without loading a provider or inventing a prompt', () => {
    const ctx = buildTurnContext(
      {
        profile: { goal: 'engineering', category: 'OC', name: 'Asha' },
        turns: [{ role: 'user', text: 'hi' }],
        summary: 'earlier: wants engineering',
      },
      { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'flowv3-prompt-')) }
    );

    assert.equal(ctx.prompt.missing, true);
    assert.equal(ctx.prompt.text, null);
    assert.equal(ctx.constraints.maxParts, 3);
    assert.ok(ctx.tools.includes('next_question'));
    assert.equal(ctx.history.entries.length, 1);
    assert.equal(ctx.summary, 'earlier: wants engineering');
  });

  test('tier 3 is ABSENT from the prompt on an ordinary turn', () => {
    const ctx = buildTurnContext(
      { profile: { goal: 'engineering', category: 'OC', gender: 'male', city: 'Hyderabad' } },
      { loadPromptText: false }
    );
    assert.equal('category' in ctx.profile.visible, false);
    assert.equal('gender' in ctx.profile.visible, false);
    assert.ok(ctx.profile.withheldFields.includes('category'));
    assert.ok(ctx.profile.withheldFields.includes('gender'));
    // The turn is otherwise intact — this withholds fields, it does not blank the profile.
    assert.equal(ctx.profile.visible.goal, 'engineering');
    assert.equal(ctx.profile.visible.city, 'Hyderabad');
  });

  test('tier 3 appears only for an allowed purpose', () => {
    for (const purpose of ['cutoff_computation', 's1_demographic_gate']) {
      const ctx = buildTurnContext(
        { profile: { category: 'OC', gender: 'male' }, purpose },
        { loadPromptText: false }
      );
      assert.equal(ctx.profile.visible.category, 'OC', `${purpose} should admit category`);
      assert.equal(ctx.profile.visible.gender, 'male', `${purpose} should admit gender`);
    }
  });

  test('an unrecognised purpose does not unlock tier 3', () => {
    const ctx = buildTurnContext(
      { profile: { category: 'OC' }, purpose: 'marketing_segmentation' },
      { loadPromptText: false }
    );
    assert.equal('category' in ctx.profile.visible, false);
  });

  test('tier 4 fields are withheld from the prompt view', () => {
    const ctx = buildTurnContext(
      {
        profile: {
          goal: 'engineering',
          category: 'OC',
          crisisLocked: true,
          accessibilityNeeds: 'wheelchair access',
        },
      },
      { loadPromptText: false }
    );
    assert.equal(ctx.profile.visible.goal, 'engineering');
    assert.equal('crisisLocked' in ctx.profile.visible, false);
    assert.equal('accessibilityNeeds' in ctx.profile.visible, false);
    assert.ok(ctx.profile.withheldFields.includes('crisisLocked'));
    // Tier 4 stays withheld even on a purpose that unlocks Tier 3.
    const eligibility = buildTurnContext(
      { profile: { crisisLocked: true, category: 'OC' }, purpose: 'cutoff_computation' },
      { loadPromptText: false }
    );
    assert.equal('crisisLocked' in eligibility.profile.visible, false);
    assert.equal(eligibility.profile.visible.category, 'OC');
  });
});
