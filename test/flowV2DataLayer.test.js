'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

describe('Flow v2 Part 13 data layer — extraction at every inbound boundary', () => {
  test('R3 paste gate: captures qualification, branch, budget, and city from one message', async () => {
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(
      ctx,
      'im in 12th mpc, want cse, budget around 3 lakhs, hyderabad only'
    );

    const profile = result.contextPatch.profile;
    assert.equal(profile.qualification, 'Class 12 (MPC)');
    assert.equal(profile.branchInterest, 'CSE');
    assert.equal(profile.budgetBand, '2_4l');
    assert.equal(profile.cityPref, 'Hyderabad');
    assert.equal(result.contextPatch.stage, 'greeting_captured_pending_b1');
  });

  test('R3 paste gate: B2 and both B3 questions skip without re-asking any volunteered fact', async () => {
    const captured = await processFlowV2Turn(
      { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } },
      'im in 12th mpc, want cse, budget around 3 lakhs, hyderabad only'
    );

    const b1Entry = await processFlowV2Turn(
      { flowV2: { stage: captured.contextPatch.stage, profile: captured.contextPatch.profile } },
      'ok'
    );
    assert.match(b1Entry.interactive.body, /what matters most/i);
    assert.doesNotMatch(b1Entry.interactive.body, /branch|budget|comfortable|moving/i);

    const b1Reply = await processFlowV2Turn(
      { flowV2: { stage: b1Entry.contextPatch.stage, profile: b1Entry.contextPatch.profile } },
      'Strong placements'
    );
    assert.equal(b1Reply.contextPatch.stage, 'b3_awaiting_entry');

    const afterB3Skip = await processFlowV2Turn(
      { flowV2: { stage: b1Reply.contextPatch.stage, profile: b1Reply.contextPatch.profile } },
      'continue'
    );
    assert.equal(afterB3Skip.contextPatch.stage, 'b5_awaiting_entry');
    const allVisibleText = [
      afterB3Skip.replyText,
      ...(afterB3Skip.replyParts || []),
      afterB3Skip.interactive && afterB3Skip.interactive.body,
    ]
      .filter(Boolean)
      .join('\n');
    assert.doesNotMatch(allVisibleText, /which field|comfortable for your family|near home|open to moving/i);
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
