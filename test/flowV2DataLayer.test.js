'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

function continueCtx(result) {
  return {
    flowV2: {
      stage: result.contextPatch.stage,
      profile: result.contextPatch.profile,
      r3OverAnswerPending: result.contextPatch.r3OverAnswerPending,
    },
  };
}

function visibleText(result) {
  return [result.replyText, ...(result.replyParts || []), result.interactive?.body]
    .filter(Boolean)
    .join('\n');
}

describe('Flow v2 Part 13 data layer — extraction at every inbound boundary', () => {
  test('R3 paste gate: captures qualification, branch, budget, and city from one message', async () => {
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(
      ctx,
      'im in 12th mpc, want cse, budget around 3 lakhs, hyderabad only'
    );

    const profile = result.contextPatch.profile;
    assert.equal(profile.qualification, '12th Completed (PCM)');
    assert.equal(profile.branchInterest, 'CSE');
    assert.equal(profile.budgetBand, '2_4l');
    assert.equal(profile.cityPref, 'Hyderabad');
    assert.equal(profile.temperature, 'hot');
    // V3: after qualification paste, next beat is B2 GOAL (3 buttons), not B4 priority.
    assert.equal(result.contextPatch.stage, 'b2_goal_awaiting_reply');
    assert.equal(result.interactive.type, 'button');
    assert.equal(result.interactive.buttons.length, 3);
    assert.match(result.interactive.body, /What are you looking for/i);
    assert.equal((result.replyParts || []).filter((part) => /12th MPC, CSE, around ₹3L, Hyderabad/.test(part)).length, 1);
  });

  test('R3 paste gate: B3 interest and constraints skip when volunteered; priority then checklist', async () => {
    const captured = await processFlowV2Turn(
      { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } },
      'im in 12th mpc, want cse, budget around 3 lakhs, hyderabad only'
    );

    const afterGoal = await processFlowV2Turn(continueCtx(captured), 'Which branch suits me');
    // Branch already filled → skip B3 interest → land on B4 priority.
    assert.equal(afterGoal.contextPatch.stage, 'b4_awaiting_reply');
    assert.equal(afterGoal.interactive.type, 'list');
    assert.equal(afterGoal.interactive.sections[0].rows.length, 7);
    assert.doesNotMatch(visibleText(afterGoal), /which field|comfortable for your family|near home|open to moving/i);

    const afterPriority = await processFlowV2Turn(continueCtx(afterGoal), 'Placements');
    assert.ok(
      afterPriority.contextPatch.stage === 'b6_permission_awaiting_reply' ||
        afterPriority.contextPatch.stage === 'b5_awaiting_reply' ||
        afterPriority.contextPatch.stage === 'b5_checklist_awaiting_entry',
      `expected checklist/permission, got ${afterPriority.contextPatch.stage}`
    );
    assert.doesNotMatch(visibleText(afterPriority), /which field|comfortable for your family|near home|open to moving/i);
    assert.doesNotMatch(visibleText(afterPriority), /12th MPC, CSE, around ₹3L, Hyderabad/i);
    assert.equal(afterPriority.contextPatch.profile.branchInterest, 'CSE');
    assert.equal(afterPriority.contextPatch.profile.budgetBand, '2_4l');
    assert.equal(afterPriority.contextPatch.profile.cityPref, 'Hyderabad');
    assert.ok(afterPriority.interactive);
  });

  test('facts survive a leaf-router interception because extraction precedes classification', async () => {
    const result = await processFlowV2Turn(
      { flowV2: { stage: 'b1_awaiting_reply', profile: emptyFlowV2Profile() } },
      'is this free? I am in Hyderabad'
    );
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
  });

  test('an inbound with no new slot never clobbers populated profile values', async () => {
    const profile = { ...emptyFlowV2Profile(), branchInterest: 'CSE', cityPref: 'Hyderabad' };
    const result = await processFlowV2Turn(
      { flowV2: { stage: 'b1_awaiting_reply', profile } },
      'is this a bot?'
    );
    assert.equal(result.contextPatch.profile.branchInterest, 'CSE');
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
  });

  test('the first inbound message is stored verbatim and botState is initialized', async () => {
    const raw = 'hi there, 12th mpc';
    const result = await processFlowV2Turn({}, raw);
    assert.equal(result.contextPatch.profile.rawFirstMessage, raw);
    assert.equal(result.contextPatch.profile.botState, 'career_counselling_flow_v2');
  });
});
