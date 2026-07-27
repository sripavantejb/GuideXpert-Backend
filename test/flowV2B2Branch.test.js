'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleB2Entry,
  handleB2Reply,
  isCoreEngineeringBranch,
  isBusinessBranch,
} = require('../services/chatbot/flowV2/nodes/b2Branch');
const { OUT_OF_SCOPE_TEXT } = require('../services/chatbot/flowV2/router/handlers/r11Handler');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');

function ctxWithProfile(patch = {}) {
  return { flowV2: { profile: { ...emptyFlowV2Profile(), ...patch } } };
}

describe('b2Branch — isCoreEngineeringBranch / isBusinessBranch', () => {
  test('mechanical/civil/ece/eee/core are all recognized as core engineering', () => {
    for (const v of ['Mechanical', 'Civil', 'ECE', 'EEE', 'core', 'MECHANICAL']) {
      assert.equal(isCoreEngineeringBranch(v), true, v);
    }
    assert.equal(isCoreEngineeringBranch('CSE'), false);
    assert.equal(isCoreEngineeringBranch(null), false);
  });

  test('Business/Commerce (and mba/bba) are recognized as the business branch', () => {
    assert.equal(isBusinessBranch('Business/Commerce'), true);
    assert.equal(isBusinessBranch('mba'), true);
    assert.equal(isBusinessBranch('CSE'), false);
  });
});

describe('b2Branch — handleB2Entry', () => {
  test('asks the B2 question (list with 6 rows) when branchInterest is empty', () => {
    const result = handleB2Entry(ctxWithProfile());
    assert.equal(result.interactive.type, 'list');
    assert.equal(result.interactive.sections[0].rows.length, 6);
    assert.equal(result.contextPatch.stage, 'b2_awaiting_reply');
  });

  test('REGRESSION (Phase 4 propagation bug): the "ask B2 question" branch still carries forward a profile mutated by an upstream caller (B1\'s chain), not just an unmutated pass-through', () => {
    const mutatedProfile = { ...emptyFlowV2Profile(), qualification: 'Class 12 (MPC)', goalPriority: ['placement'] };
    const result = handleB2Entry({ flowV2: { profile: mutatedProfile } });
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    assert.deepEqual(result.contextPatch.profile.goalPriority, ['placement']);
  });

  test('SKIP to B3 works when branchInterest is pre-filled and non-core (e.g. CSE)', () => {
    const result = handleB2Entry(ctxWithProfile({ branchInterest: 'CSE' }));
    assert.equal(result.contextPatch.stage, 'b3_awaiting_entry');
    // Silent structural skip — no B2 list, no unexpected message.
    assert.equal(result.interactive, null);
  });

  test('SKIP to the core fork works when branchInterest is pre-filled AS core (R4-D "I want mechanical" must still trigger the full fork, not bypass it)', () => {
    const result = handleB2Entry(ctxWithProfile({ branchInterest: 'Mechanical' }));
    assert.equal(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.equal(result.contextPatch.profile.coreBridgeAttempted, true);
    assert.ok(result.replyParts && result.replyParts.length > 0);
  });

  test('SKIP: "Business" with a pre-filled branchInterest routes to R11, reusing its exact copy', () => {
    const result = handleB2Entry(ctxWithProfile({ branchInterest: 'Business/Commerce' }));
    assert.equal(result.interactive.body, OUT_OF_SCOPE_TEXT);
  });

  test('coreBridgeClosed makes it structurally impossible to re-enter the fork, even if branchInterest reads back as core', () => {
    const result = handleB2Entry(ctxWithProfile({ coreBridgeClosed: true, branchInterest: 'core' }));
    assert.notEqual(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.equal(result.contextPatch.stage, 'b3_awaiting_entry');
    assert.equal(result.replyParts, null);
    assert.equal(result.interactive, null);
  });
});

describe('b2Branch — handleB2Reply', () => {
  test('"Coding / software / AI" tap acks and advances to B3 with branchInterest=cse_ai', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Coding / software / AI');
    assert.equal(result.contextPatch.profile.branchInterest, 'cse_ai');
    assert.equal(result.contextPatch.stage, 'b3_awaiting_entry');
    assert.ok(result.replyText);
  });

  test('"Design / product" tap acks and advances to B3', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Design / product');
    assert.equal(result.contextPatch.profile.branchInterest, 'design');
    assert.equal(result.contextPatch.stage, 'b3_awaiting_entry');
  });

  test('"Data / analytics" tap acks and advances to B3', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Data / analytics');
    assert.equal(result.contextPatch.profile.branchInterest, 'data_analytics');
    assert.equal(result.contextPatch.stage, 'b3_awaiting_entry');
  });

  test('"Core engineering (mech, civil, ECE)" tap routes into the fork, does NOT advance to B3 directly', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Core engineering (mech, civil, ECE)');
    assert.equal(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b3_awaiting_entry');
  });

  test('"Business / management" tap with no catalog routes to R11, reusing its existing handler (not duplicated copy)', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Business / management');
    assert.equal(result.interactive.body, OUT_OF_SCOPE_TEXT);
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), ['Book a session', 'Tell me about tech anyway']);
  });

  test('"Not sure yet" does NOT set a default branchInterest and re-asks (never silently defaults)', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Not sure yet');
    assert.equal(result.contextPatch.profile.branchInterest, null);
    assert.equal(result.contextPatch.stage, 'b2_awaiting_reply');
    assert.equal(result.interactive.type, 'list');
  });
});

describe('b2Branch — full dispatcher regression', () => {
  test('an R4-rank message at stage=b2_awaiting_reply keeps rank silently, re-asks the branch question (never a default)', async () => {
    const ctx = { flowV2: { stage: 'b2_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'my rank is 5000');
    assert.equal(result.contextPatch.profile.rank, 5000);
    assert.equal(result.contextPatch.profile.branchInterest, null);
    assert.equal(result.contextPatch.stage, 'b2_awaiting_reply');
  });
});
