'use strict';

/**
 * hotfix/distress-turn-url-suppression
 *
 * R7-T1 (and interrupt-resume) must never deliver a booking URL in any reply
 * part. Empathy / confirmation still delivers.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { R7_TIER1_EMPATHY_LINE } = require('../services/chatbot/flowV2/router/handlers/r7Tier1Handler');
const {
  textContainsBookingUrl,
  resultContainsBookingUrl,
  combineWithDistressUrlSuppression,
} = require('../services/chatbot/flowV2/flowV2DistressUrlGuard');
const { BOOKING_URL } = require('../services/chatbot/flowV2/nodes/node0Override');
const guidanceBookingService = require('../services/guidanceBookingService');

function allReplyText(result) {
  const bits = [];
  if (result.replyText) bits.push(result.replyText);
  if (Array.isArray(result.replyParts)) bits.push(...result.replyParts);
  if (result.interactive?.body) bits.push(result.interactive.body);
  return bits.join('\n');
}

describe('flowV2DistressUrlGuard — unit', () => {
  test('detects the hardcoded Node 0 booking URL', () => {
    assert.equal(textContainsBookingUrl(`👉 ${BOOKING_URL}`), true);
    assert.equal(textContainsBookingUrl('no link here'), false);
  });

  test('suppression drops URL parts and freezes stage/profile', () => {
    const out = combineWithDistressUrlSuppression({
      prefix: 'empathy',
      fallthrough: {
        replyText: `Great — here’s your booking form:\n\n👉 ${BOOKING_URL}`,
        replyParts: null,
        interactive: { type: 'button', body: 'backfill?', buttons: [] },
        contextPatch: {
          stage: 'b7_awaiting_done',
          profile: { ...emptyFlowV2Profile(), bookingStatus: 'link_sent' },
        },
      },
      preserveStage: 'b7_awaiting_slot',
      preserveProfile: { ...emptyFlowV2Profile(), bookingStatus: 'booking_started' },
      preserveHybridSlotOffers: [],
    });
    assert.deepEqual(out.replyParts, ['empathy']);
    assert.equal(out.interactive, null);
    assert.equal(out.contextPatch.stage, 'b7_awaiting_slot');
    assert.equal(out.contextPatch.profile.bookingStatus, 'booking_started');
    assert.equal(resultContainsBookingUrl(out), false);
  });

  test('non-URL fallthrough still prepends the prefix', () => {
    const out = combineWithDistressUrlSuppression({
      prefix: 'empathy',
      fallthrough: {
        replyText: 'Which goal fits best?',
        replyParts: null,
        contextPatch: { stage: 'b1_awaiting_reply', profile: emptyFlowV2Profile() },
      },
      preserveStage: 'b1_awaiting_reply',
      preserveProfile: emptyFlowV2Profile(),
    });
    assert.deepEqual(out.replyParts, ['empathy', 'Which goal fits best?']);
  });
});

describe('flowV2Dispatcher — R7-T1 distress turn never ships a booking URL', () => {
  test('R7-T1 on b7_awaiting_slot: empathy delivered, zero URLs in any part', async (t) => {
    t.mock.method(guidanceBookingService, 'getAvailableActiveSlots', async () => []);

    const ctx = {
      flowV2: {
        stage: 'b7_awaiting_slot',
        profile: {
          ...emptyFlowV2Profile(),
          bookingStatus: 'booking_started',
          recommendation: 'NIAT',
        },
        hybridSlotOffers: [],
      },
    };

    // Without the guard, free-text on the slot stage becomes a website handoff URL.
    // "i failed" is R7 Tier-1 (disappointment) — empathy must stand alone.
    const result = await processFlowV2Turn(ctx, 'i failed');

    assert.ok(Array.isArray(result.replyParts) && result.replyParts.length >= 1);
    assert.equal(result.replyParts[0], R7_TIER1_EMPATHY_LINE);
    assert.equal(resultContainsBookingUrl(result), false);
    assert.doesNotMatch(allReplyText(result), /https?:\/\//i);
    assert.doesNotMatch(allReplyText(result), /guidexpert\.co\.in\/one-on-one-session/i);
    // Must not stick link_sent without delivering the URL.
    assert.notEqual(result.contextPatch?.profile?.bookingStatus, 'link_sent');
    assert.equal(result.contextPatch?.stage, 'b7_awaiting_slot');
  });

  test('R7-T1 on a non-booking stage still prepends empathy and continues the stage', async () => {
    const ctx = {
      flowV2: {
        stage: 'b1_awaiting_reply',
        profile: emptyFlowV2Profile(),
      },
    };
    const result = await processFlowV2Turn(ctx, 'i failed');
    assert.equal(result.replyParts?.[0], R7_TIER1_EMPATHY_LINE);
    assert.ok(result.replyParts.length >= 2 || result.interactive, 'stage reply must still land');
    assert.equal(resultContainsBookingUrl(result), false);
  });
});

describe('flowV2Dispatcher — interrupt-resume never ships a booking URL as part 2+', () => {
  test('resolving I-1 while interrupted from b7_awaiting_slot suppresses the URL', async (t) => {
    t.mock.method(guidanceBookingService, 'getAvailableActiveSlots', async () => []);

    const profile = {
      ...emptyFlowV2Profile(),
      bookingStatus: 'booking_started',
      recommendation: 'NIAT',
    };
    const ctx = {
      flowV2: {
        stage: 'interrupt_i1_awaiting_reply',
        interruptedStage: 'b7_awaiting_slot',
        profile,
        hybridSlotOffers: [],
      },
    };

    // I-1 resolution: "building" → confirmation + resume fallthrough on slot stage.
    const result = await processFlowV2Turn(ctx, 'building things');

    assert.ok(result.replyParts?.[0], 'confirmation / empathy-style prefix must deliver');
    assert.equal(resultContainsBookingUrl(result), false);
    assert.doesNotMatch(allReplyText(result), /https?:\/\//i);
    assert.doesNotMatch(allReplyText(result), /guidexpert\.co\.in\/one-on-one-session/i);
  });
});
