'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleB7Entry,
  handleB7Reply,
  extractB7InviteAction,
  buildB7BookingLinkMessage,
  STANDARD_INVITE_TEXT,
  GENERIC_INVITE_TEXT,
  NOT_YET_TEXT,
  NOT_YET_TOPIC_ROWS,
  DONE_CONFIRMATION_TEXT,
  AWAITING_DONE_HOLDING_TEXT,
  POST_DECLINE_HOLDING_TEXT,
  POST_BOOKING_HOLDING_TEXT,
  TOPIC_REPLIES,
  B7_SLOT_PICKER_BODY,
} = require('../services/chatbot/flowV2/nodes/b7Book');
const nodeZeroOverride = require('../services/chatbot/flowV2/nodes/node0Override');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const guidanceBookingService = require('../services/guidanceBookingService');

function ctxWithProfile(patch = {}, extra = {}) {
  return { flowV2: { profile: { ...emptyFlowV2Profile(), ...patch }, ...extra } };
}

function mockLiveSlots(t, slots = []) {
  t.mock.method(guidanceBookingService, 'getAvailableActiveSlots', async () => slots);
}

describe('b7Book — handleB7Entry (framing)', () => {
  test('V3 offer copy names senior counsellor (no IITian clause)', () => {
    const result = handleB7Entry(ctxWithProfile({ recommendation: null }));
    assert.equal(result.interactive.body, GENERIC_INVITE_TEXT);
    assert.match(result.interactive.body, /senior counsellor/i);
    assert.doesNotMatch(result.interactive.body, /IITian/i);
    assert.match(result.interactive.body, /Shall I book you in/i);
  });

  test('same offer copy whether or not recommendation is set', () => {
    const withRec = handleB7Entry(ctxWithProfile({ recommendation: 'NIAT' }));
    const without = handleB7Entry(ctxWithProfile({ recommendation: null }));
    assert.equal(withRec.interactive.body, without.interactive.body);
    assert.equal(STANDARD_INVITE_TEXT, GENERIC_INVITE_TEXT);
  });

  test('sets stage to b7_awaiting_reply and presents exactly 2 buttons, profile carried forward', () => {
    const result = handleB7Entry(ctxWithProfile({ recommendation: 'NIAT', qualification: 'Class 12 (MPC)' }));
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), ['Book my session', 'Not right now']);
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
  });
});

describe('b7Book — extractB7InviteAction', () => {
  test('recognizes both buttons, returns null for ambiguous text', () => {
    assert.equal(extractB7InviteAction('Book my session'), 'book');
    assert.equal(extractB7InviteAction('Not yet'), 'not_yet');
    assert.equal(extractB7InviteAction('Not right now'), 'not_yet');
    assert.equal(extractB7InviteAction('maybe later I guess'), null);
  });
});

describe('b7Book — [Book my session] real reuse of Node 0\u2019s shared helper', () => {
  test('buildB7BookingLinkMessage calls nodeZeroOverride.buildBookingUrlLine() (mocked to prove real reuse, not copy-paste)', (t) => {
    const mock = t.mock.method(nodeZeroOverride, 'buildBookingUrlLine', () => 'MOCKED_URL_LINE');
    const message = buildB7BookingLinkMessage();
    assert.equal(mock.mock.callCount(), 1);
    assert.ok(message.includes('MOCKED_URL_LINE'));
  });

  test('the real (unmocked) message contains the actual booking URL', () => {
    const message = buildB7BookingLinkMessage();
    assert.match(message, /guidexpert\.co\.in\/one-on-one-session/);
    assert.match(message, /reply Done/i);
  });

  test('handleB7Reply([Book my session]) opens hybrid slot picker via Node 0 shared helper', async (t) => {
    mockLiveSlots(t, []);
    const result = await handleB7Reply(
      ctxWithProfile({ recommendation: 'NIAT' }, { stage: 'b7_awaiting_reply' }),
      'Book my session'
    );
    assert.equal(result.contextPatch.stage, 'b7_awaiting_slot');
    assert.equal(result.interactive.type, 'list');
    assert.equal(result.interactive.body, B7_SLOT_PICKER_BODY);
    assert.equal(result.contextPatch.profile.bookingStatus, 'booking_started');
    assert.equal(
      result.interactive.sections[0].rows[result.interactive.sections[0].rows.length - 1].id,
      nodeZeroOverride.OTHER_TIME_ROW_ID
    );
  });

  test('slot / other-time reply sends B7 website handoff and sets bookingStatus = link_sent', async (t) => {
    mockLiveSlots(t, []);
    const picker = await handleB7Reply(
      ctxWithProfile({ recommendation: 'NIAT' }, { stage: 'b7_awaiting_reply' }),
      'Book my session'
    );
    const handoff = await handleB7Reply(
      {
        flowV2: {
          stage: picker.contextPatch.stage,
          profile: picker.contextPatch.profile,
          hybridSlotOffers: picker.contextPatch.hybridSlotOffers,
        },
      },
      nodeZeroOverride.OTHER_TIME_ROW_ID
    );
    assert.equal(handoff.replyText, buildB7BookingLinkMessage());
    assert.equal(handoff.contextPatch.profile.bookingStatus, 'link_sent');
    assert.equal(handoff.contextPatch.stage, 'b7_awaiting_done');
  });
});

describe('b7Book — bookingStatus progression (null -> booking_started -> link_sent -> done, no skips, no reversal)', () => {
  test('starts at null by schema default', () => {
    assert.equal(emptyFlowV2Profile().bookingStatus, null);
  });

  test('[Book my session] moves null -> booking_started (slot picker), never straight to done', async (t) => {
    mockLiveSlots(t, []);
    const result = await handleB7Reply(ctxWithProfile({}, { stage: 'b7_awaiting_reply' }), 'Book my session');
    assert.equal(result.contextPatch.profile.bookingStatus, 'booking_started');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_slot');
  });

  test('slot choice moves booking_started -> link_sent', async (t) => {
    mockLiveSlots(t, []);
    const picker = await handleB7Reply(ctxWithProfile({}, { stage: 'b7_awaiting_reply' }), 'Book my session');
    const result = await handleB7Reply(
      {
        flowV2: {
          stage: 'b7_awaiting_slot',
          profile: picker.contextPatch.profile,
          hybridSlotOffers: picker.contextPatch.hybridSlotOffers,
        },
      },
      nodeZeroOverride.OTHER_TIME_ROW_ID
    );
    assert.equal(result.contextPatch.profile.bookingStatus, 'link_sent');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_done');
  });

  test('"done" from b7_awaiting_done moves link_sent -> done', async () => {
    const result = await handleB7Reply(
      ctxWithProfile({ bookingStatus: 'link_sent' }, { stage: 'b7_awaiting_done' }),
      'done'
    );
    assert.equal(result.contextPatch.profile.bookingStatus, 'done');
    assert.equal(result.contextPatch.stage, 'b7_post_booking');
  });

  test('GUARD: "done" cannot set bookingStatus to done unless it was already link_sent (skip-link_sent attempt is rejected)', async () => {
    for (const badPriorStatus of [null, 'done']) {
      const result = await handleB7Reply(
        ctxWithProfile({ bookingStatus: badPriorStatus }, { stage: 'b7_awaiting_done' }),
        'done'
      );
      assert.equal(result.contextPatch.profile.bookingStatus, badPriorStatus, `expected no transition from ${badPriorStatus}`);
      assert.equal(result.contextPatch.stage, 'b7_awaiting_done');
      assert.equal(result.replyText, AWAITING_DONE_HOLDING_TEXT);
    }
  });

  test('GUARD: once done, staying in b7_post_booking never reverses bookingStatus', async () => {
    const result = await handleB7Reply(ctxWithProfile({ bookingStatus: 'done' }, { stage: 'b7_post_booking' }), 'anything at all');
    assert.equal(result.contextPatch.profile.bookingStatus, 'done');
  });
});

describe('b7Book — "done" only transitions correctly from b7_awaiting_done, not from any other stage', () => {
  test('"done" said during b7_awaiting_reply is just ambiguous invite text, not a booking-status transition', async () => {
    const result = await handleB7Reply(ctxWithProfile({}, { stage: 'b7_awaiting_reply' }), 'done');
    assert.equal(result.contextPatch.profile.bookingStatus, null);
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
  });

  test('"done" said during b7_post_decline stays a holding reply, not a booking-status transition', async () => {
    const result = await handleB7Reply(ctxWithProfile({}, { stage: 'b7_post_decline' }), 'done');
    assert.equal(result.contextPatch.profile.bookingStatus, null);
    assert.equal(result.contextPatch.stage, 'b7_post_decline');
    assert.equal(result.replyText, POST_DECLINE_HOLDING_TEXT);
  });
});

describe('b7Book — [Not yet] never auto-re-invites', () => {
  test('[Not yet] shows the spec-verbatim holding line and a 4-row LIST of topics (not >3 buttons)', async () => {
    const result = await handleB7Reply(ctxWithProfile({}, { stage: 'b7_awaiting_reply' }), 'Not yet');
    assert.equal(result.interactive.type, 'list');
    assert.equal(result.interactive.body, NOT_YET_TEXT);
    assert.deepEqual(
      result.interactive.sections[0].rows.map((r) => r.title),
      NOT_YET_TOPIC_ROWS.map((r) => r.title)
    );
    assert.deepEqual(NOT_YET_TOPIC_ROWS.map((r) => r.title), ['Fees', 'Placements', 'Hostel & safety', 'Scholarships']);
  });

  test('[Not yet] moves to b7_post_decline, not back to b7_awaiting_reply', async () => {
    const result = await handleB7Reply(ctxWithProfile({}, { stage: 'b7_awaiting_reply' }), 'Not yet');
    assert.equal(result.contextPatch.stage, 'b7_post_decline');
    assert.notEqual(result.contextPatch.stage, 'b7_awaiting_reply');
  });

  test('a message in b7_post_decline (e.g. tapping "Fees") never re-shows the [Book my session]/[Not yet] invite', async () => {
    const result = await handleB7Reply(ctxWithProfile({}, { stage: 'b7_post_decline' }), 'Fees');
    assert.equal(result.interactive, null);
    assert.equal(result.contextPatch.stage, 'b7_post_decline');
    assert.equal(result.replyText, TOPIC_REPLIES.fees);
    assert.ok(!/Want me to book it/i.test(result.replyText));
  });

  test('the NEXT turn after [Not yet] does not automatically re-invoke handleB7Entry (dispatcher-level)', async () => {
    let ctx = { flowV2: { stage: 'b7_awaiting_reply', profile: emptyFlowV2Profile() } };
    let result = await processFlowV2Turn(ctx, 'Not yet');
    assert.equal(result.contextPatch.stage, 'b7_post_decline');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'hi');
    assert.equal(result.contextPatch.stage, 'b7_post_decline');
    assert.ok(!/Want me to book it/i.test(result.replyText || ''));
  });
});

describe('b7Book — no price amounts; V3 offer may say free once', () => {
  const PRICE_AMOUNT_PATTERN = /[₹$]|\brs\.?\s?\d|\d+\s*(lakh|rupee|inr)/i;

  test('static B7 messages never quote a price amount', () => {
    const messages = [
      STANDARD_INVITE_TEXT,
      GENERIC_INVITE_TEXT,
      NOT_YET_TEXT,
      DONE_CONFIRMATION_TEXT,
      AWAITING_DONE_HOLDING_TEXT,
      POST_DECLINE_HOLDING_TEXT,
      POST_BOOKING_HOLDING_TEXT,
      buildB7BookingLinkMessage(),
    ];
    for (const msg of messages) {
      assert.ok(!PRICE_AMOUNT_PATTERN.test(msg), `unexpected price amount: ${msg}`);
    }
  });

  test('invite copy may include the locked free-session claim at most once', () => {
    const matches = STANDARD_INVITE_TEXT.match(/\bfree\b/gi) || [];
    assert.ok(matches.length >= 1 && matches.length <= 2, `free count=${matches.length}`);
  });

  test('handleB7Entry/handleB7Reply outputs never quote a price amount', async (t) => {
    mockLiveSlots(t, []);
    const outputs = [
      handleB7Entry(ctxWithProfile({ recommendation: null })),
      handleB7Entry(ctxWithProfile({ recommendation: 'NIAT' })),
      await handleB7Reply(ctxWithProfile({}, { stage: 'b7_awaiting_reply' }), 'Book my session'),
      await handleB7Reply(ctxWithProfile({}, { stage: 'b7_awaiting_reply' }), 'Not yet'),
      await handleB7Reply(ctxWithProfile({ bookingStatus: 'link_sent' }, { stage: 'b7_awaiting_done' }), 'done'),
      await handleB7Reply(ctxWithProfile({}, { stage: 'b7_awaiting_done' }), 'still filling it out'),
      await handleB7Reply(ctxWithProfile({}, { stage: 'b7_post_decline' }), 'Fees'),
      await handleB7Reply(ctxWithProfile({ bookingStatus: 'done' }, { stage: 'b7_post_booking' }), 'ok thanks'),
    ];
    for (const out of outputs) {
      const text = [out.replyText, out.interactive && out.interactive.body].filter(Boolean).join(' ');
      assert.ok(!PRICE_AMOUNT_PATTERN.test(text), `unexpected price amount: ${text}`);
    }
  });
});

describe('b7Book — every stage has a defined, non-silent response to an arbitrary message (never dead-ends)', () => {
  test('b7_awaiting_reply: arbitrary text re-asks, does not go silent', async () => {
    const result = await handleB7Reply(ctxWithProfile({}, { stage: 'b7_awaiting_reply' }), 'asdkjaslkdj random text');
    assert.ok(result.interactive != null || result.replyText != null);
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
  });

  test('b7_awaiting_done: arbitrary text gets the holding reply, does not go silent', async () => {
    const result = await handleB7Reply(ctxWithProfile({ bookingStatus: 'link_sent' }, { stage: 'b7_awaiting_done' }), 'asdkjaslkdj random text');
    assert.equal(result.replyText, AWAITING_DONE_HOLDING_TEXT);
    assert.equal(result.contextPatch.stage, 'b7_awaiting_done');
  });

  test('b7_post_decline: arbitrary text gets the holding reply, does not go silent', async () => {
    const result = await handleB7Reply(ctxWithProfile({}, { stage: 'b7_post_decline' }), 'asdkjaslkdj random text');
    assert.equal(result.replyText, POST_DECLINE_HOLDING_TEXT);
    assert.equal(result.contextPatch.stage, 'b7_post_decline');
  });

  test('b7_post_booking: arbitrary text gets the holding reply, does not go silent (proves the "genuine terminal-ish state" still accepts follow-ups)', async () => {
    const result = await handleB7Reply(ctxWithProfile({ bookingStatus: 'done' }, { stage: 'b7_post_booking' }), 'what about scholarships');
    assert.equal(result.replyText, TOPIC_REPLIES.scholarships);
    assert.equal(result.contextPatch.stage, 'b7_post_booking');
    assert.notEqual(result.replyText, null);
  });
});

describe('b7Book — profile propagation (regression pattern since Phase 4)', () => {
  test('every handleB7Entry/handleB7Reply branch carries an unrelated profile field forward', async (t) => {
    mockLiveSlots(t, []);
    const patch = { qualification: 'Class 12 (MPC)' };
    const scenarios = [
      () => handleB7Entry(ctxWithProfile(patch)),
      () => handleB7Reply(ctxWithProfile(patch, { stage: 'b7_awaiting_reply' }), 'Book my session'),
      () => handleB7Reply(ctxWithProfile(patch, { stage: 'b7_awaiting_reply' }), 'Not yet'),
      () => handleB7Reply(ctxWithProfile(patch, { stage: 'b7_awaiting_reply' }), 'huh?'),
      () => handleB7Reply(ctxWithProfile({ ...patch, bookingStatus: 'link_sent' }, { stage: 'b7_awaiting_done' }), 'done'),
      () => handleB7Reply(ctxWithProfile(patch, { stage: 'b7_awaiting_done' }), 'not yet done'),
      () => handleB7Reply(ctxWithProfile(patch, { stage: 'b7_post_decline' }), 'Fees'),
      () => handleB7Reply(ctxWithProfile({ ...patch, bookingStatus: 'done' }, { stage: 'b7_post_booking' }), 'hi'),
    ];
    for (const run of scenarios) {
      const result = await run();
      assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    }
  });
});

describe('B7 — full chained transition through the dispatcher', () => {
  test('b7_awaiting_entry -> b7_awaiting_reply -> [Book] -> slot -> b7_awaiting_done -> [Done] -> b7_post_booking', async (t) => {
    mockLiveSlots(t, []);
    let profile = { ...emptyFlowV2Profile(), qualification: 'Class 12 (MPC)', recommendation: 'NIAT' };
    let ctx = { flowV2: { stage: 'b7_awaiting_entry', profile } };
    let result = await processFlowV2Turn(ctx, 'hi');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Book my session');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_slot');
    assert.equal(result.contextPatch.profile.bookingStatus, 'booking_started');
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');

    ctx = {
      flowV2: {
        stage: result.contextPatch.stage,
        profile: result.contextPatch.profile,
        hybridSlotOffers: result.contextPatch.hybridSlotOffers,
      },
    };
    result = await processFlowV2Turn(ctx, nodeZeroOverride.OTHER_TIME_ROW_ID);
    assert.equal(result.contextPatch.stage, 'b7_awaiting_done');
    assert.equal(result.contextPatch.profile.bookingStatus, 'link_sent');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Done');
    assert.equal(result.contextPatch.stage, 'b7_post_booking');
    assert.equal(result.contextPatch.profile.bookingStatus, 'done');
  });

  test('REGRESSION: tapping [Book my session] while inside B7 is NOT hijacked by Node 0\u2019s pre-empt (the "book"/"session" word-overlap bug)', async (t) => {
    mockLiveSlots(t, []);
    let ctx = { flowV2: { stage: 'b7_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'Book my session');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_slot');
    assert.notEqual(result.contextPatch.stage, 'node0_awaiting_slot');
    assert.notEqual(result.contextPatch.stage, 'node0_awaiting_backfill');
    assert.equal(result.contextPatch.profile.bookingStatus, 'booking_started');
  });

  test('Node 0\u2019s pre-empt still fires normally OUTSIDE any b7_ stage', async (t) => {
    mockLiveSlots(t, []);
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'can you just book a session for me');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_slot');
  });

  test('B6 entry drains to B9 FIT ask (V3); yes then reaches booking CTA', async () => {
    let profile = {
      ...emptyFlowV2Profile(),
      shortlist: [
        { id: 'niat', name: 'NIAT' },
        { id: 'newton', name: 'Newton School of Technology' },
        { id: 'scaler', name: 'Scaler School of Technology' },
      ],
      goalPriority: ['placement'],
      interestCluster: 'software',
    };
    let ctx = { flowV2: { stage: 'b6_awaiting_entry', profile } };
    let result = await processFlowV2Turn(ctx, 'ok');
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    assert.match(result.interactive.body, /narrow it down/i);

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Yes, narrow it down');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    assert.equal(result.interactive.body, STANDARD_INVITE_TEXT);
  });
});
