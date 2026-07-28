'use strict';

/**
 * Full Flow V3 happy-path e2e: B1→B10 spine assertions.
 * Guards against legacy Best Match / early budget / old greeting copy.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

function visible(result) {
  return [...(result.replyParts || []), result.replyText, result.interactive?.body]
    .filter(Boolean)
    .join('\n');
}

describe('Full Flow V3 — happy path PCM spine', () => {
  test('hi → qualify → goal → interest → priority → checklist → permission → constraints → two models → 3-flat → FIT → B10 URL path', async (t) => {
    t.mock.method(
      require('../services/guidanceBookingService'),
      'getAvailableActiveSlots',
      async () => []
    );

    let ctx = { flowV2: { stage: null, profile: emptyFlowV2Profile() } };
    let result = await processFlowV2Turn(ctx, 'hi');
    let text = visible(result);
    assert.match(text, /where are you right now|Choose your stage|First —/i);
    assert.doesNotMatch(text, /Can I know your qualifications/i);

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    // Name if asked
    if (String(result.contextPatch.stage || '').includes('name')) {
      result = await processFlowV2Turn(ctx, 'Arjun');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }
    // Qualification — PCM
    if (
      result.contextPatch.stage === 'greeting_awaiting_qualification' ||
      result.contextPatch.stage === 'greeting_awaiting_reply'
    ) {
      result = await processFlowV2Turn(ctx, 'Class 12 (MPC)');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    // B2 GOAL
    if (result.contextPatch.stage === 'b2_goal_awaiting_reply' || result.interactive?.buttons?.some((b) => /branch|college|career/i.test(b.title))) {
      result = await processFlowV2Turn(ctx, 'flowv2_b2_goal_college');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    // B3 INTEREST — multi-select then done
    if (result.contextPatch.stage === 'b2_awaiting_reply') {
      result = await processFlowV2Turn(ctx, 'Computers & software');
      assert.equal(result.contextPatch.stage, 'b2_awaiting_reply');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
      result = await processFlowV2Turn(ctx, 'done');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    // B4 PRIORITY
    if (result.contextPatch.stage === 'b4_awaiting_reply' || result.contextPatch.stage === 'b1_awaiting_reply') {
      result = await processFlowV2Turn(ctx, 'Strong placements');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    // May already be on permission after checklist drain
    text = visible(result);
    assert.doesNotMatch(text, /comfortable for your family/i); // no early budget before permission

    if (result.contextPatch.stage === 'b6_permission_awaiting_reply') {
      result = await processFlowV2Turn(ctx, 'flowv2_b6_yes');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    // B6.5 constraints if asked
    if (result.contextPatch.stage === 'b3_awaiting_budget') {
      result = await processFlowV2Turn(ctx, '₹2–5L');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }
    if (result.contextPatch.stage === 'b3_awaiting_location') {
      result = await processFlowV2Turn(ctx, 'Open to move');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    text = visible(result);
    assert.doesNotMatch(text, /\*Best Match\*/i);
    assert.match(text, /two models|Established colleges|GuideXpert works with|narrow it down/i);

    // Land on FIT
    if (result.contextPatch.stage === 'b9_awaiting_reply') {
      result = await processFlowV2Turn(ctx, 'Yes, narrow it down');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    text = visible(result);
    assert.match(text, /senior counsellor/i);
    assert.doesNotMatch(text, /IITian/i);

    result = await processFlowV2Turn(ctx, 'Book my session');
    assert.ok(
      result.contextPatch.stage === 'b7_awaiting_slot' || result.contextPatch.stage === 'b7_awaiting_done',
      result.contextPatch.stage
    );

    if (result.contextPatch.stage === 'b7_awaiting_slot') {
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile, hybridSlotOffers: result.contextPatch.hybridSlotOffers } };
      result = await processFlowV2Turn(ctx, 'Some other time — I\'ll tell you');
    }
    text = visible(result);
    assert.match(text, /guidexpert\.co\.in\/one-on-one-session/i);
    assert.equal(result.contextPatch.profile.bookingStatus, 'link_sent');
  });
});
