'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const {
  canSendNudge,
  buildSilenceNudge,
  MIDFLOW_NUDGE_MS,
  GREETING_NUDGE_MS,
} = require('../services/chatbot/flowV2/router/handlers/r13Handler');
const { getGuidedFlowByBotState } = require('../services/chatbot/guidedFlows/guidedFlowRegistry');
const {
  processCareerCounsellingFlowV2Turn,
} = require('../services/chatbot/guidedFlows/guidedFlowProcessors');
const fs = require('fs');
const path = require('path');

function profileWith(patch) {
  return { ...emptyFlowV2Profile(), ...patch };
}

describe('Stage 8 — interrupts I-3..I-7', () => {
  test('I-3 family mention parks and returns with parentConstraints', async () => {
    const ctx = {
      flowV2: {
        stage: 'b3_awaiting_budget',
        profile: profileWith({ name: 'Riya', goalPriority: ['placement'] }),
      },
    };
    const start = await processFlowV2Turn(ctx, 'my parents want a known brand college');
    assert.equal(start.contextPatch.stage, 'interrupt_i3_awaiting_reply');
    assert.equal(start.contextPatch.interruptedStage, 'b3_awaiting_budget');

    const done = await processFlowV2Turn(
      {
        flowV2: {
          stage: 'interrupt_i3_awaiting_reply',
          interruptedStage: 'b3_awaiting_budget',
          profile: start.contextPatch.profile,
        },
      },
      'Known brand'
    );
    assert.equal(done.contextPatch.profile.parentConstraints, 'known_brand');
    assert.equal(done.contextPatch.stage, 'b3_awaiting_budget');
  });

  test('I-7 session cost answers free immediately', async () => {
    const ctx = {
      flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya' }) },
    };
    const result = await processFlowV2Turn(ctx, 'how much does this session cost');
    assert.ok(/free/i.test(result.replyText || result.interactive?.body || ''));
    assert.notEqual(result.contextPatch.stage, 'node0_awaiting_backfill');
  });

  test('I-6 out of scope offers book or tech', async () => {
    const ctx = {
      flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya' }) },
    };
    const result = await processFlowV2Turn(ctx, 'I want MBBS advice');
    assert.equal(result.contextPatch.stage, 'interrupt_i6_awaiting_reply');
    assert.equal(result.contextPatch.profile.outOfScope, true);
  });
});

describe('Stage 8 — R13 nudge gate', () => {
  test('opted_out / parked_core / crisisLocked never get a nudge', () => {
    assert.equal(canSendNudge(profileWith({ optedOut: true }), 'b5_awaiting_reply'), false);
    assert.equal(canSendNudge(profileWith({}), 'parked_core'), false);
    assert.equal(canSendNudge(profileWith({ crisisLocked: true }), 'b1_awaiting_reply'), false);
    assert.equal(canSendNudge(profileWith({ nudgeSent: true }), 'b1_awaiting_reply'), false);
  });

  test('first eligible mid-flow silence consumes the one lifetime nudge', () => {
    const first = buildSilenceNudge({
      profile: profileWith({ name: 'Riya' }),
      stage: 'b5_awaiting_reply',
      silenceMs: MIDFLOW_NUDGE_MS,
    });
    assert.ok(first);
    assert.equal(first.contextPatch.profile.nudgeSent, true);

    const second = buildSilenceNudge({
      profile: first.contextPatch.profile,
      stage: 'b5_awaiting_reply',
      silenceMs: MIDFLOW_NUDGE_MS * 2,
    });
    assert.equal(second, null);
  });

  test('greeting silence uses 4h threshold', () => {
    const early = buildSilenceNudge({
      profile: profileWith({ name: 'Riya' }),
      stage: 'greeting_awaiting_name',
      silenceMs: GREETING_NUDGE_MS - 1,
    });
    assert.equal(early, null);
    const ready = buildSilenceNudge({
      profile: profileWith({ name: 'Riya' }),
      stage: 'greeting_awaiting_name',
      silenceMs: GREETING_NUDGE_MS,
    });
    assert.ok(ready);
    assert.equal(ready.contextPatch.stage, 'greeted_no_reply');
  });
});

describe('Stage 8 — live wiring + Rithika rename', () => {
  test('guided flow registry exposes career_counselling_flow_v2', () => {
    const flow = getGuidedFlowByBotState('career_counselling_flow_v2');
    assert.ok(flow);
    assert.equal(flow.id, 'career_counselling_flow_v2');
    assert.equal(flow.contextKey, 'flowV2');
  });

  test('processor persists context.flowV2 from processFlowV2Turn', async () => {
    const turn = await processCareerCounsellingFlowV2Turn({
      inboundText: 'Hi',
      inbound: { _id: 'inbound1', messageType: 'text' },
      contextPatch: { flowV2: { stage: null, profile: null } },
      isNewEntry: true,
    });
    assert.equal(turn.nextState, 'career_counselling_flow_v2');
    assert.ok(turn.contextPatch.flowV2);
    assert.ok(turn.contextPatch.flowV2.stage);
  });

  test('Flow v2 runtime copy has no I\'m Guide bot identity (Rithika rename)', () => {
    const roots = [
      path.join(__dirname, '../services/chatbot/flowV2'),
      path.join(__dirname, '../test'),
    ];
    const offenders = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!/\.(js|md)$/.test(entry.name)) continue;
        if (entry.name.includes('GUIDEXPERT_MASTER_FLOW')) continue;
        if (entry.name === 'flowV2Stage8.test.js') continue;
        const text = fs.readFileSync(full, 'utf8');
        if (/I'?m Guide\b/.test(text) || /I am Guide\b/.test(text)) {
          offenders.push(full);
        }
      }
    }
    for (const root of roots) walk(root);
    assert.deepEqual(offenders, []);
  });
});
