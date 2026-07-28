'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleCoreForkExitEntry,
  handleCoreForkExitReply,
  isAngerShaped,
  EXIT_MESSAGE_1,
  EXIT_MESSAGE_2,
  EXIT_MESSAGE_3,
  EXIT_MESSAGE_4,
  WARM_CLOSE_TEXT,
  TRANSITION_TEXT,
  APOLOGY_TEXT,
  NEUTRAL_CLOSE_TEXT,
} = require('../services/chatbot/flowV2/nodes/b2CoreForkExit');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');

function ctxWithProfile(patch = {}) {
  return { flowV2: { profile: { ...emptyFlowV2Profile(), ...patch } } };
}

describe('b2CoreForkExit — handleCoreForkExitEntry', () => {
  test('sends the full 4-message sequence verbatim, in order', () => {
    const result = handleCoreForkExitEntry(ctxWithProfile({ coreInterest: 'mechanical', coreBridgeAttempted: true }));
    assert.deepEqual(result.replyParts, [EXIT_MESSAGE_1, EXIT_MESSAGE_2, EXIT_MESSAGE_3]);
    assert.equal(result.interactive.body, EXIT_MESSAGE_4);
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), [
      'Thanks, that helps',
      'Actually, tell me about that route',
    ]);
  });

  test('the checklist message includes all five bullet points', () => {
    const result = handleCoreForkExitEntry(ctxWithProfile());
    const checklist = result.replyParts[2];
    assert.match(checklist, /Go SEE the workshop and labs/);
    assert.match(checklist, /SolidWorks, ANSYS, CATIA/);
    assert.match(checklist, /CORE placement numbers/);
    assert.match(checklist, /internship tie-ups/);
    assert.match(checklist, /GATE support/);
  });

  test('sets branchInterest=core and coreBridgeClosed=true', () => {
    const result = handleCoreForkExitEntry(ctxWithProfile({ coreInterest: 'civil' }));
    assert.equal(result.contextPatch.profile.branchInterest, 'core');
    assert.equal(result.contextPatch.profile.coreBridgeClosed, true);
    assert.equal(result.contextPatch.stage, 'b2_core_exit_awaiting_reply');
  });
});

describe('b2CoreForkExit — handleCoreForkExitReply (F2a)', () => {
  test('"Thanks, that helps" sends the warm close and sets parked_core', () => {
    const result = handleCoreForkExitReply(ctxWithProfile({ coreBridgeClosed: true }), 'Thanks, that helps');
    assert.equal(result.replyText, WARM_CLOSE_TEXT);
    assert.equal(result.contextPatch.stage, 'parked_core');
  });

  test('once parked_core, no further Flow v2 message is auto-sent on a later unrelated turn', async () => {
    const ctx = { flowV2: { stage: 'parked_core', profile: { ...emptyFlowV2Profile(), coreBridgeClosed: true } } };
    const result = await processFlowV2Turn(ctx, 'hello again');
    // safeFallbackReply — a fixed, generic, non-resuming line. Must NOT be
    // any B1/B2/fork copy, and must not re-open any beat.
    assert.equal(result.nextState, 'career_counselling_flow_v2');
    assert.notEqual(result.contextPatch.stage, 'b1_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b2_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
  });
});

describe('b2CoreForkExit — handleCoreForkExitReply (F2b)', () => {
  test('"Actually, tell me about that route" overwrites branchInterest, keeps coreInterest, advances to B3', () => {
    const ctx = ctxWithProfile({ coreInterest: 'mechanical', coreBridgeAttempted: true, coreBridgeClosed: true, branchInterest: 'core' });
    const result = handleCoreForkExitReply(ctx, 'Actually, tell me about that route');
    assert.equal(result.contextPatch.profile.branchInterest, 'cse_ai');
    assert.equal(result.contextPatch.profile.coreInterest, 'mechanical');
    assert.equal(result.replyText, TRANSITION_TEXT);
    assert.equal(result.contextPatch.stage, 'b3_awaiting_entry');
  });

  test('the joke/pitch cannot re-fire — coreBridgeAttempted stays true, and re-running handleB2Entry never re-enters the fork', () => {
    const { handleB2Entry } = require('../services/chatbot/flowV2/nodes/b2Branch');
    const ctx = ctxWithProfile({ coreInterest: 'mechanical', coreBridgeAttempted: true, coreBridgeClosed: true, branchInterest: 'core' });
    const transitioned = handleCoreForkExitReply(ctx, 'Actually, tell me about that route');
    const resumed = handleB2Entry({ flowV2: { profile: transitioned.contextPatch.profile } });
    assert.notEqual(resumed.contextPatch.stage, 'b2_core_fork_awaiting_reply');
  });
});

describe('b2CoreForkExit — isAngerShaped (new heuristic — R12 does not cover this)', () => {
  test('detects anger-shaped phrasing', () => {
    assert.equal(isAngerShaped('this is a total waste of time'), true);
    assert.equal(isAngerShaped('why did you even ask then'), true);
    assert.equal(isAngerShaped("what's the point of this"), true);
    assert.equal(isAngerShaped('forget it'), true);
  });

  test('does not false-positive on neutral text', () => {
    assert.equal(isAngerShaped('Thanks, that helps'), false);
    assert.equal(isAngerShaped('Actually, tell me about that route'), false);
  });
});

describe('b2CoreForkExit — handleCoreForkExitReply (F2c)', () => {
  test('an anger-shaped reply gets the apology line, then closes as parked_core', () => {
    const ctx = ctxWithProfile({ coreBridgeClosed: true });
    const result = handleCoreForkExitReply(ctx, "this is a waste of time, why did you even ask");
    assert.equal(result.replyText, APOLOGY_TEXT);
    assert.equal(result.contextPatch.stage, 'parked_core');
  });
});

describe('b2CoreForkExit — handleCoreForkExitReply (unrecognized)', () => {
  test('an unrecognized reply does NOT loop the 4-message exit sequence again, closes neutrally as parked_core', () => {
    const ctx = ctxWithProfile({ coreBridgeClosed: true });
    const result = handleCoreForkExitReply(ctx, 'asdkjaskjd random text');
    assert.equal(result.replyText, NEUTRAL_CLOSE_TEXT);
    assert.equal(result.replyParts, null);
    assert.equal(result.contextPatch.stage, 'parked_core');
  });
});

describe('b2CoreForkExit — full dispatcher regression (F2 -> F2a end to end)', () => {
  test('"I want pure mechanical" then "Thanks, that helps" ends at parked_core with no further beat resuming', async () => {
    let ctx = { flowV2: { stage: 'b2_core_fork_awaiting_reply', profile: { ...emptyFlowV2Profile(), coreInterest: 'mechanical', coreBridgeAttempted: true, branchInterest: 'Mechanical' } } };
    const exitResult = await processFlowV2Turn(ctx, 'I want pure mechanical');
    assert.equal(exitResult.contextPatch.stage, 'b2_core_exit_awaiting_reply');

    ctx = { flowV2: { stage: exitResult.contextPatch.stage, profile: exitResult.contextPatch.profile } };
    const closeResult = await processFlowV2Turn(ctx, 'Thanks, that helps');
    assert.equal(closeResult.contextPatch.stage, 'parked_core');
    assert.equal(closeResult.replyText, WARM_CLOSE_TEXT);
  });
});
