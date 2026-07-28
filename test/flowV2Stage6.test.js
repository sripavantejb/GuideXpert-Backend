'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const {
  setR4PDeps,
  R4P_RESULTS_STAGE,
  R4P_BRIDGE_STAGE,
  R4P_PARKED_STAGE,
  BRIDGE_TEXT,
  STICK_RANK_CLOSE,
} = require('../services/chatbot/flowV2/nodes/r4pPredictor');
const { classifyReply } = require('../services/chatbot/flowV2/router/classifyReply');

function profileWith(patch) {
  return { ...emptyFlowV2Profile(), ...patch };
}

const MOCK_COLLEGES = [
  { college_name: 'Mock A', branches: [{ branch_name: 'CSE' }] },
  { college_name: 'Mock B', branches: [{ branch_name: 'ECE' }] },
  { college_name: 'Mock C', branches: [{ branch_name: 'CSE' }] },
  { college_name: 'Mock D', branches: [{ branch_name: 'MECH' }] },
  { college_name: 'Mock E', branches: [{ branch_name: 'CIVIL' }] },
  { college_name: 'Mock F', branches: [{ branch_name: 'CSE' }] },
];

before(() => {
  setR4PDeps({
    fetchCollegeDostColleges: async () => ({ colleges: MOCK_COLLEGES, total_no_of_colleges: MOCK_COLLEGES.length }),
  });
});
after(() => setR4PDeps({}));

describe('Stage 6 — R4 classify + handlers', () => {
  test('R4-D goal sub-case classifies "i want cse"', () => {
    const c = classifyReply('i want cse', emptyFlowV2Profile(), { stage: 'b1_awaiting_reply' });
    assert.equal(c.bucket, 'R4');
    assert.equal(c.subCase, 'goal');
  });

  test('R4-A rank message routes into R4-P slot or results', async () => {
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya', qualification: '12th Completed (PCM)' }) } };
    const result = await processFlowV2Turn(ctx, 'my TS EAMCET rank is 18453 OC Female');
    assert.ok(['r4p_awaiting_slot', R4P_RESULTS_STAGE].includes(result.contextPatch.stage));
    assert.equal(result.contextPatch.profile.jumpType, 'rank');
  });

  test('R4-B unknown college gets checklist, not a fabricated pitch', async () => {
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya' }) } };
    const result = await processFlowV2Turn(ctx, 'is FakeUnknownCollege any good?');
    assert.ok(String(result.interactive?.body || result.replyText || '').includes("won't guess"));
  });

  test('R4-B known college (NIAT) offers compare buttons', async () => {
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya' }) } };
    const result = await processFlowV2Turn(ctx, 'is NIAT any good?');
    assert.equal(result.contextPatch.stage, 'r4_college_awaiting_reply');
    assert.equal(result.contextPatch.profile.collegeOfInterest, 'NIAT');
    assert.ok(result.interactive.buttons.some((b) => /compare/i.test(b.title)));
  });

  test('R4-C money opens budget buttons', async () => {
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya' }) } };
    const result = await processFlowV2Turn(ctx, 'what is the fees / low budget');
    assert.equal(result.contextPatch.stage, 'r4_money_awaiting_reply');
    assert.equal(result.contextPatch.profile.jumpType, 'money');
  });

  test('R4-D mechanical fires core fork', async () => {
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya', qualification: '12th Completed (PCM)' }) } };
    const result = await processFlowV2Turn(ctx, 'i want mechanical');
    assert.equal(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.equal(String(result.contextPatch.profile.branchInterest).toLowerCase(), 'mechanical');
  });

  test('R4-E best college reframes into B1 list', async () => {
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya' }) } };
    const result = await processFlowV2Turn(ctx, 'which is the best college for cse');
    assert.equal(result.contextPatch.stage, 'b1_awaiting_reply');
    assert.equal(result.contextPatch.profile.jumpType, 'best');
    const body = result.interactive?.body || '';
    assert.ok(/best/i.test(body));
    assert.ok(/matters most/i.test(body));
  });

  test('R4-F never invents a deadline', async () => {
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya' }) } };
    const result = await processFlowV2Turn(ctx, 'when does admission close');
    assert.equal(result.contextPatch.stage, 'r4_admission_awaiting_reply');
    assert.ok(/won't guess at dates/i.test(result.interactive.body));
  });

  test('R4-G vs sets hot temperature', async () => {
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: profileWith({ name: 'Riya' }) } };
    const result = await processFlowV2Turn(ctx, 'NIAT vs Scaler');
    assert.equal(result.contextPatch.stage, 'r4_vs_awaiting_reply');
    assert.equal(result.contextPatch.profile.temperature, 'hot');
  });
});

describe('Stage 6 — R4-P sticky + bridge', () => {
  test('complete slots → sticky results buttons, no fabricated tiers', async () => {
    const ctx = {
      flowV2: {
        stage: 'b1_awaiting_reply',
        profile: profileWith({
          name: 'Riya',
          examType: 'TS_EAMCET',
          rank: 18453,
          category: 'OC',
          gender: 'female',
        }),
      },
    };
    const result = await processFlowV2Turn(ctx, 'TS EAMCET rank 18453 OC Female');
    assert.equal(result.contextPatch.stage, R4P_RESULTS_STAGE);
    assert.deepEqual(
      result.interactive.buttons.map((b) => b.title),
      ['Show more', 'Filter these', 'Help me choose']
    );
    assert.ok(!/safe|likely|stretch/i.test(result.interactive.body));
  });

  test('Help me choose → bridge; Stick to my rank list parks once', async () => {
    const base = {
      flowV2: {
        stage: R4P_RESULTS_STAGE,
        profile: profileWith({
          examType: 'TS_EAMCET',
          rank: 18453,
          category: 'OC',
          gender: 'female',
          predictedColleges: ['Mock A'],
        }),
        r4pSticky: { resultCache: MOCK_COLLEGES, pageOffset: 5, predictorCtx: { exam: 'TS_EAMCET', rank: 18453 } },
      },
    };
    const bridge = await processFlowV2Turn(base, 'Help me choose');
    assert.equal(bridge.contextPatch.stage, R4P_BRIDGE_STAGE);
    assert.ok(bridge.interactive.body.includes('second route'));
    assert.equal(bridge.interactive.body, BRIDGE_TEXT);

    const parked = await processFlowV2Turn(
      {
        flowV2: {
          stage: R4P_BRIDGE_STAGE,
          profile: bridge.contextPatch.profile,
          r4pSticky: base.flowV2.r4pSticky,
        },
      },
      'Stick to my rank list'
    );
    assert.equal(parked.contextPatch.stage, R4P_PARKED_STAGE);
    assert.equal(parked.replyText, STICK_RANK_CLOSE);
    assert.equal(parked.contextPatch.profile.predictorBridgeChoice, 'rank_only');
  });

  test('Show me both seeds qualification and rejoins B4 priority', async () => {
    const ctx = {
      flowV2: {
        stage: R4P_BRIDGE_STAGE,
        profile: profileWith({
          examType: 'TS_EAMCET',
          rank: 18453,
          category: 'OC',
          gender: 'female',
          predictorBridgeShown: true,
        }),
        r4pSticky: { resultCache: MOCK_COLLEGES },
      },
    };
    const result = await processFlowV2Turn(ctx, 'Show me both');
    assert.equal(result.contextPatch.profile.predictorBridgeChoice, 'both');
    assert.equal(result.contextPatch.profile.qualification, '12th Completed (PCM)');
    // V3: Show me both calls handleB1Entry (now B4 priority).
    assert.ok(
      result.contextPatch.stage === 'b4_awaiting_reply' ||
        result.contextPatch.stage === 'b2_goal_awaiting_reply' ||
        result.contextPatch.stage === 'b6_permission_awaiting_reply',
      `expected B4 priority (or B2 goal / permission), got ${result.contextPatch.stage}`
    );
  });

  test('Node 0 still wins Connect me mid-results', async () => {
    const ctx = {
      flowV2: {
        stage: R4P_RESULTS_STAGE,
        profile: profileWith({ examType: 'TS_EAMCET', rank: 1, category: 'OC', gender: 'female' }),
        r4pSticky: { resultCache: MOCK_COLLEGES },
      },
    };
    const result = await processFlowV2Turn(ctx, 'Connect me');
    assert.ok(String(result.replyText || result.interactive?.body || '').includes('http') || result.contextPatch.stage === 'node0_awaiting_backfill' || result.contextPatch.stage === 'node0_awaiting_slot' || /book|session|guidexpert/i.test(String(result.replyText || result.interactive?.body || '')));
  });
});
