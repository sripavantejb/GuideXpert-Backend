'use strict';

/**
 * Full Flow V3 happy-path e2e: company Stage 1–10 PCM spine.
 * Shortlist ask after Stage 7; NIAT interest gate before booking.
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
  test('hi → … → two models → ask → top 5 → FIT → NIAT pitch → interest → B10', async (t) => {
    t.mock.method(
      require('../services/guidanceBookingService'),
      'getAvailableActiveSlots',
      async () => []
    );

    let ctx = { flowV2: { stage: null, profile: emptyFlowV2Profile() } };
    let result = await processFlowV2Turn(ctx, 'hi');
    let text = visible(result);
    assert.match(text, /Welcome to GuideXpert|current qualifications|Choose your stage/i);

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
      result = await processFlowV2Turn(ctx, 'flowv2_b2_goal_college');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    if (result.contextPatch.stage === 'b2_awaiting_reply') {
      result = await processFlowV2Turn(ctx, 'Computers');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
      result = await processFlowV2Turn(ctx, 'done');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    if (result.contextPatch.stage === 'b4_awaiting_reply' || result.contextPatch.stage === 'b1_awaiting_reply') {
      result = await processFlowV2Turn(ctx, 'Placements');
      ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    }

    text = visible(result);
    assert.doesNotMatch(text, /comfortable for your family/i);
    assert.match(text, /Got it|curriculum updated|suggest colleges that match/i);
    assert.equal(result.contextPatch.stage, 'b6_permission_awaiting_reply');

    result = await processFlowV2Turn(ctx, 'flowv2_b6_yes');
    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };

    assert.notEqual(result.contextPatch.stage, 'b3_awaiting_budget');
    text = visible(result);
    assert.match(text, /Traditional Colleges|New-Age Colleges/i);
    assert.match(text, /top 5 colleges that match/i);
    assert.doesNotMatch(text, /Newton School of Technology/);
    assert.equal(result.contextPatch.stage, 'b8_shortlist_ask_awaiting_reply');

    result = await processFlowV2Turn(ctx, 'Yes, show me');
    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    text = visible(result);
    assert.match(text, /Newton School|Polar School of Technology|best fit/i);
    assert.match(text, /🥇|🥈|🥉/);
    assert.equal(result.contextPatch.profile.shortlist.length, 5);
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');

    result = await processFlowV2Turn(ctx, 'Yes, help me');
    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    text = visible(result);
    assert.match(text, /NIAT|Decode|partner|Internship|Placement support/i);
    assert.match(text, /exploring NIAT further|interested/i);
    assert.doesNotMatch(text, /Book My Session|IITian/);
    assert.equal(result.contextPatch.stage, 'b9_niat_interest_awaiting_reply');

    result = await processFlowV2Turn(ctx, "Yes, I'm interested");
    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    text = visible(result);
    assert.match(text, /IITian|book your session|FREE 1:1/i);
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    assert.equal(result.contextPatch.profile.niatInterest, true);
    assert.ok(result.interactive?.buttons?.some((b) => /Book My Session/i.test(b.title)));

    result = await processFlowV2Turn(ctx, 'Book My Session');
    text = visible(result);
    assert.match(text, /guidexpert\.co\.in\/one-on-one-session/i);
    assert.equal(result.contextPatch.stage, 'b7_awaiting_done');
    assert.equal(result.contextPatch.profile.bookingStatus, 'link_sent');
  });
});
