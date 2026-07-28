'use strict';

/**
 * Full Flow V3 happy-path e2e: company Stage 1–10 PCM spine (Option 3).
 * Guards against B6.5 on happy path, 5-flat catalog, and senior-counsellor copy.
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

describe('Full Flow V3 — happy path PCM spine (company Option 3)', () => {
  test('hi → qualify → goal → interest → priority → checklist → permission → two models → 3-medal → FIT → B10 URL path', async (t) => {
    t.mock.method(
      require('../services/guidanceBookingService'),
      'getAvailableActiveSlots',
      async () => []
    );

    let ctx = { flowV2: { stage: null, profile: emptyFlowV2Profile() } };
    let result = await processFlowV2Turn(ctx, 'hi');
    let text = visible(result);
    assert.match(text, /Welcome to GuideXpert|current qualifications|Choose your stage/i);
    assert.doesNotMatch(text, /Takes about 2 minutes/i);

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    if (String(result.contextPatch.stage || '').includes('name')) {
      result = await processFlowV2Turn(ctx, 'Arjun');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }
    if (
      result.contextPatch.stage === 'greeting_awaiting_qualification' ||
      result.contextPatch.stage === 'greeting_awaiting_reply'
    ) {
      result = await processFlowV2Turn(ctx, '12th Completed (PCM)');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    if (
      result.contextPatch.stage === 'b2_goal_awaiting_reply' ||
      result.interactive?.buttons?.some((b) => /branch|college|career/i.test(b.title))
    ) {
      text = visible(result);
      assert.match(text, /What are you looking for/i);
      result = await processFlowV2Turn(ctx, 'flowv2_b2_goal_college');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    if (result.contextPatch.stage === 'b2_awaiting_reply') {
      text = visible(result);
      assert.match(text, /topics excite you/i);
      result = await processFlowV2Turn(ctx, 'Computers');
      assert.equal(result.contextPatch.stage, 'b2_awaiting_reply');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
      result = await processFlowV2Turn(ctx, 'done');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    if (result.contextPatch.stage === 'b4_awaiting_reply' || result.contextPatch.stage === 'b1_awaiting_reply') {
      text = visible(result);
      assert.match(text, /One more thing/i);
      result = await processFlowV2Turn(ctx, 'Placements');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    text = visible(result);
    assert.doesNotMatch(text, /comfortable for your family/i);
    assert.match(text, /Got it|curriculum updated|suggest colleges that match/i);

    if (result.contextPatch.stage === 'b6_permission_awaiting_reply') {
      result = await processFlowV2Turn(ctx, 'flowv2_b6_yes');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    // Option 3: B6.5 must NOT fire on PCM happy path.
    assert.notEqual(result.contextPatch.stage, 'b3_awaiting_budget');
    assert.notEqual(result.contextPatch.stage, 'b3_awaiting_location');
    assert.notEqual(result.contextPatch.stage, 'b65_awaiting_entry');

    text = visible(result);
    assert.doesNotMatch(text, /\*Best Match\*/i);
    assert.doesNotMatch(text, /\bPlaksha\b|\bKalvium\b/i);
    assert.match(text, /Traditional Colleges|New-Age Colleges|Newton School|best fit/i);
    assert.match(text, /🥇|🥈|🥉/);

    if (result.contextPatch.stage === 'b9_awaiting_reply') {
      result = await processFlowV2Turn(ctx, 'Yes, help me');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    text = visible(result);
    assert.match(text, /IITian/i);
    assert.doesNotMatch(text, /senior counsellor/i);
    assert.match(text, /Book your session|Would you like to book/i);

    result = await processFlowV2Turn(ctx, 'Book My Session');
    assert.ok(
      result.contextPatch.stage === 'b7_awaiting_slot' || result.contextPatch.stage === 'b7_awaiting_done',
      result.contextPatch.stage
    );

    if (result.contextPatch.stage === 'b7_awaiting_slot') {
      ctx = {
        flowV2: {
          stage: result.contextPatch.stage,
          profile: result.contextPatch.profile,
          hybridSlotOffers: result.contextPatch.hybridSlotOffers,
        },
      };
      result = await processFlowV2Turn(ctx, "Some other time — I'll tell you");
    }
    text = visible(result);
    assert.match(text, /guidexpert\.co\.in\/one-on-one-session/i);
    assert.equal(result.contextPatch.profile.bookingStatus, 'link_sent');
  });
});
