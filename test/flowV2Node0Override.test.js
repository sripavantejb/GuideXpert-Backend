'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOverrideIntent,
  handleNode0Override,
  handleNode0SlotReply,
  BOOKING_LINK_MESSAGE,
  BOOKING_URL,
  buildBookingUrlLine,
  SLOT_PICKER_BODY,
  OTHER_TIME_ROW_ID,
  buildLiveSlotListRows,
  buildHybridWebsiteHandoffMessage,
} = require('../services/chatbot/flowV2/nodes/node0Override');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const guidanceBookingService = require('../services/guidanceBookingService');

function istTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function mockLiveSlots(t, slots) {
  t.mock.method(guidanceBookingService, 'getAvailableActiveSlots', async () => slots);
}

describe('flowV2 Node 0 override — detection', () => {
  test('matches each documented trigger phrase (word-boundary aware)', () => {
    const phrases = [
      'book',
      'call me',
      'talk to someone',
      'counsellor',
      'counselor',
      'session',
      'human',
      'phone number',
      'connect me',
      'talk to a person',
      'agent',
    ];
    for (const phrase of phrases) {
      assert.equal(detectOverrideIntent(phrase), true, `expected "${phrase}" to trigger override`);
    }
  });

  test('does NOT false-positive on unrelated substrings', () => {
    assert.equal(detectOverrideIntent('what is your cancellation policy'), false);
    assert.equal(detectOverrideIntent('my personal goal is AI'), false);
    assert.equal(detectOverrideIntent('I am interested in humanities subjects'), false);
  });

  test('is case-insensitive', () => {
    assert.equal(detectOverrideIntent('CALL ME NOW'), true);
    assert.equal(detectOverrideIntent('Talk To A Counsellor'), true);
  });
});

/**
 * GENERAL INVARIANT (Phase 7 follow-up — not a b7_*-specific check):
 *
 * The B7 fix exempted b7_* stages from Node 0's pre-empt because B7's own
 * "Book my session" button collided with OVERRIDE_PATTERNS' bare
 * `\bbook\b`/`\bsession\b`. That fix only proves TODAY's b7_* vocabulary is
 * safe — it is not a structural guarantee. Nothing stops a future beat
 * (B8+, or a new button added to an existing beat) from introducing a
 * button/list-row label that collides with an override pattern, nor stops
 * OVERRIDE_PATTERNS itself from being widened to catch a real missed
 * booking intent and retroactively colliding with existing copy. Either
 * change would silently reintroduce this exact class of bug in whichever
 * beat it lands in, with no other test anywhere positioned to catch it.
 *
 * This test asserts the GENERAL property instead of the b7_* special
 * case, and is deliberately self-updating so it doesn't rot the day
 * someone adds a beat or a button and forgets this test exists:
 *
 * 1. It scans every node file that actually lives in
 *    services/chatbot/flowV2/nodes/ at test-run time (fs.readdirSync, not
 *    a hardcoded file list) and deep-walks every exported value looking
 *    for `{ title: '...' }` shapes — the exact convention every node file
 *    in this codebase already follows for its button/list-row constants
 *    ("exported for focused unit testing"). A newly added node file, or a
 *    newly added button constant in an existing file, is picked up with
 *    zero changes to this test.
 * 2. It additionally invokes every known beat's own entry function
 *    directly (the literal ask: "feed the exact button labels that
 *    stage's own entry function generates") and extracts whatever
 *    `interactive` buttons/rows it actually produces at runtime, as a
 *    second, independent check that doesn't rely on a constant having
 *    been separately exported.
 *
 * If either layer ever finds a title that false-positives against
 * detectOverrideIntent() — whether that's because a new button collided
 * with today's patterns, or because OVERRIDE_PATTERNS was widened and
 * retroactively collided with existing copy — this test fails with the
 * offending title and exactly where it came from.
 */
describe('flowV2 Node 0 override — general invariant: no beat\u2019s button/row vocabulary may ever collide with OVERRIDE_PATTERNS', () => {
  const NODES_DIR = path.join(__dirname, '..', 'services', 'chatbot', 'flowV2', 'nodes');
  const HANDLERS_DIR = path.join(__dirname, '..', 'services', 'chatbot', 'flowV2', 'router', 'handlers');
  const INTERRUPTS_FILE = path.join(__dirname, '..', 'services', 'chatbot', 'flowV2', 'nonDistressInterrupts.js');

  function deepCollectTitles(value, source, out, depth = 0) {
    if (depth > 6 || value === null || value === undefined) return;
    const type = typeof value;
    if (type !== 'object' && type !== 'function') return;
    if (type === 'function') return; // functions are invoked separately below, not walked
    if (Array.isArray(value)) {
      value.forEach((item, i) => deepCollectTitles(item, `${source}[${i}]`, out, depth + 1));
      return;
    }
    if (typeof value.title === 'string') out.push({ title: value.title, source });
    for (const [key, val] of Object.entries(value)) {
      if (key === 'title') continue;
      deepCollectTitles(val, `${source}.${key}`, out, depth + 1);
    }
  }

  /** Extracts every button/list-row title from a standard Flow v2 node
   * return shape's `interactive` field (button-type `.buttons` or
   * list-type `.sections[].rows`) — reuses the same generic deep walker
   * since both shapes are just nested title-bearing objects/arrays. */
  function titlesFromInteractive(interactive, source, out) {
    if (!interactive) return;
    deepCollectTitles(interactive, source, out);
  }

  /** Known entry-point functions across the B1-B7 spine + Stage 6–8 leaves,
   * called directly with a minimal representative ctx so this test satisfies
   * the literal ask (feed what "that stage's own entry function generates"),
   * in addition to the auto-discovering export scan above. */
  function callKnownEntryFunctions(out) {
    const freshCtx = () => ({ flowV2: { stage: null, profile: emptyFlowV2Profile() } });

    const entryPoints = [
      { name: 'greeting.handleGreetingEntry', load: () => require('../services/chatbot/flowV2/nodes/greeting').handleGreetingEntry(freshCtx()) },
      { name: 'b1Goal.handleB1Entry', load: () => require('../services/chatbot/flowV2/nodes/b1Goal').handleB1Entry(freshCtx()) },
      { name: 'b2Branch.handleB2Entry', load: () => require('../services/chatbot/flowV2/nodes/b2Branch').handleB2Entry(freshCtx()) },
      { name: 'b2CoreFork.handleCoreForkEntry', load: () => require('../services/chatbot/flowV2/nodes/b2CoreFork').handleCoreForkEntry(freshCtx(), '') },
      { name: 'b2CoreForkExit.handleCoreForkExitEntry', load: () => require('../services/chatbot/flowV2/nodes/b2CoreForkExit').handleCoreForkExitEntry(freshCtx()) },
      { name: 'b3Constraints.handleB3Entry', load: () => require('../services/chatbot/flowV2/nodes/b3Constraints').handleB3Entry(freshCtx()) },
      { name: 'b5Shortlist.handleB5Entry', load: () => require('../services/chatbot/flowV2/nodes/b5Shortlist').handleB5Entry(freshCtx()) },
      { name: 'b6TheCase.handleB6Entry', load: () => require('../services/chatbot/flowV2/nodes/b6TheCase').handleB6Entry(freshCtx()) },
      { name: 'b7Book.handleB7Entry', load: () => require('../services/chatbot/flowV2/nodes/b7Book').handleB7Entry(freshCtx()) },
      { name: 'r4pPredictor.handleR4PEntry', load: () => require('../services/chatbot/flowV2/nodes/r4pPredictor').handleR4PEntry(freshCtx()) },
      { name: 'r5Handler.handleR5', load: () => require('../services/chatbot/flowV2/router/handlers/r5Handler').handleR5(freshCtx(), 'is this a bot') },
      { name: 'r11Handler.handleR11', load: () => require('../services/chatbot/flowV2/router/handlers/r11Handler').handleR11() },
    ];

    for (const { name, load } of entryPoints) {
      let result;
      try {
        result = load();
      } catch (err) {
        continue;
      }
      titlesFromInteractive(result && result.interactive, name, out);
    }
  }

  /**
   * Closed allowlist of titles that MAY collide with OVERRIDE_PATTERNS.
   * Two classes — do not conflate them:
   *
   * CLASS A — dispatcher-mitigated (B7 owns its own booking button):
   * - "Book my session" (B7): exempted via `b7_*` stage skip in
   *   flowV2Dispatcher.js so B7's own flow runs. See flowV2B7Book.test.js
   *   "REGRESSION: tapping [Book my session] while inside B7 is NOT hijacked".
   *
   * CLASS B — intentional Node 0 handoffs (collision IS the product):
   * Tapping these SHOULD fire Node 0's booking-link path. No stage
   * exemption. Same pattern as R4-P "Connect me".
   * - "Connect me" (R4-P blocked demographic)
   * - "Book a session" (R11 / I-6 out-of-scope CTAs)
   * - "Book the session" (R4-F admission CTA)
   * - "Get me a human" (R5 identity CTA → Node 0 / counsellor handoff)
   *
   * Any OTHER colliding title anywhere in Stages 1–8 still fails this test.
   */
  const KNOWN_MITIGATED_COLLISION_TITLES = new Set([
    '📅 Book My Session',
    'Connect me',
    'Book a session',
    'Book the session',
    'Get me a human',
  ]);

  test('every discoverable button/list-row title across Stages 1-8 (nodes + handlers + interrupts) passes detectOverrideIntent() as false, except the closed allowlist', () => {
    const collected = [];

    // Layer 1 — auto-discovering export scan across nodes + router handlers + interrupts.
    const nodeFiles = fs.readdirSync(NODES_DIR).filter((f) => f.endsWith('.js'));
    for (const file of nodeFiles) {
      const mod = require(path.join(NODES_DIR, file));
      deepCollectTitles(mod, `nodes/${file}`, collected);
    }
    const handlerFiles = fs.readdirSync(HANDLERS_DIR).filter((f) => f.endsWith('.js'));
    for (const file of handlerFiles) {
      const mod = require(path.join(HANDLERS_DIR, file));
      deepCollectTitles(mod, `handlers/${file}`, collected);
    }
    deepCollectTitles(require(INTERRUPTS_FILE), 'nonDistressInterrupts.js', collected);

    // Layer 2 — direct entry-function invocation (the literal ask).
    callKnownEntryFunctions(collected);

    assert.ok(
      collected.length >= 20,
      `expected to discover a substantial number of button/row titles across Stages 1-8, found ${collected.length} — the discovery heuristic in this test may need updating`
    );

    const allCollisions = collected.filter((entry) => detectOverrideIntent(entry.title));
    const unexpectedCollisions = allCollisions.filter((entry) => !KNOWN_MITIGATED_COLLISION_TITLES.has(entry.title));
    assert.deepEqual(
      unexpectedCollisions,
      [],
      `found NEW, unvetted button/list-row title(s) colliding with OVERRIDE_PATTERNS (must be exempted at the dispatcher level, regression-tested, and added to KNOWN_MITIGATED_COLLISION_TITLES if intentional): ${JSON.stringify(unexpectedCollisions)}`
    );

    const foundKnownTitles = new Set(allCollisions.map((entry) => entry.title));
    for (const knownTitle of KNOWN_MITIGATED_COLLISION_TITLES) {
      assert.ok(
        foundKnownTitles.has(knownTitle),
        `expected the known, allowlisted collision "${knownTitle}" to still exist and still collide — if it no longer does, remove it from KNOWN_MITIGATED_COLLISION_TITLES and reconsider whether the b7_* dispatcher exemption is still needed`
      );
    }
  });
});

describe('flowV2 Node 0 override — buildBookingUrlLine extraction (Phase 7, pure refactor)', () => {
  test('BOOKING_LINK_MESSAGE is byte-identical to its pre-extraction value (regression lock-in)', () => {
    assert.equal(
      BOOKING_LINK_MESSAGE,
      'Absolutely \u2014 here\u2019s your booking form:\n\uD83D\uDC49 https://www.guidexpert.co.in/one-on-one-session\nOnce you submit, just reply Done here.'
    );
  });

  test('buildBookingUrlLine() returns the exact line BOOKING_LINK_MESSAGE was built from', () => {
    assert.equal(buildBookingUrlLine(), '\uD83D\uDC49 https://www.guidexpert.co.in/one-on-one-session');
    assert.ok(BOOKING_LINK_MESSAGE.includes(buildBookingUrlLine()));
  });

  test('BOOKING_URL is the bare URL, no emoji/prefix', () => {
    assert.equal(BOOKING_URL, 'https://www.guidexpert.co.in/one-on-one-session');
  });
});

describe('flowV2 Node 0 override — hybrid slot picker (HYBRID_BOOKING_WEBSITE_CREATE)', () => {
  test('shows live slots list + Some other time; stage node0_awaiting_slot; no CRM bookingStatus=link_sent yet', async (t) => {
    const today = istTodayYmd();
    mockLiveSlots(t, [
      {
        id: 'slotA',
        slotDate: today,
        slotTime: '4:00 PM',
        sessionTitle: '1-on-1',
        counselorName: 'Ada',
        bookingClosed: false,
      },
      {
        id: 'slotB',
        slotDate: today,
        slotTime: '6:00 PM',
        sessionTitle: '1-on-1',
        counselorName: 'Ada',
        bookingClosed: false,
      },
    ]);

    const result = await handleNode0Override({ flowV2: { profile: emptyFlowV2Profile() } }, 'I want to book');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_slot');
    assert.equal(result.interactive.type, 'list');
    assert.match(result.interactive.body, /When suits you/);
    assert.equal(result.interactive.body, SLOT_PICKER_BODY);
    const rows = result.interactive.sections[0].rows;
    assert.ok(rows.length >= 2);
    assert.equal(rows[rows.length - 1].id, OTHER_TIME_ROW_ID);
    assert.equal(rows[rows.length - 1].title, 'Some other time');
    assert.ok(rows.some((r) => String(r.title).startsWith('Today')));
    assert.equal(result.contextPatch.profile.bookingStatus, 'booking_started');
    assert.equal(result.contextPatch.profile.temperature, 'hot');
    assert.equal(result.contextPatch.profile.door, 'booking_intent');
    assert.ok(Array.isArray(result.contextPatch.hybridSlotOffers));
    assert.doesNotMatch(String(result.replyText || ''), /guidexpert\.co\.in/);
  });

  test('caps live rows so total list length stays within WhatsApp limits (≤10 including other time)', () => {
    const today = istTodayYmd();
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      slotDate: today,
      slotTime: `${i + 1}:00 PM`,
      bookingClosed: false,
    }));
    const { rows } = buildLiveSlotListRows(many);
    assert.ok(rows.length <= 10);
    assert.equal(rows[rows.length - 1].id, OTHER_TIME_ROW_ID);
  });

  test('slot tap → website URL handoff + backfill; bookingStatus link_sent; never claims CRM create', async (t) => {
    mockLiveSlots(t, [
      { id: 'slotA', slotDate: istTodayYmd(), slotTime: '4:00 PM', bookingClosed: false },
    ]);
    const picker = await handleNode0Override({ flowV2: { profile: emptyFlowV2Profile() } }, 'book');
    const slotRow = picker.interactive.sections[0].rows.find((r) => r.id.startsWith('flowv2_node0_slot_'));
    assert.ok(slotRow);

    const handoff = handleNode0SlotReply(
      {
        flowV2: {
          stage: picker.contextPatch.stage,
          profile: picker.contextPatch.profile,
          hybridSlotOffers: picker.contextPatch.hybridSlotOffers,
        },
      },
      slotRow.id
    );

    assert.equal(handoff.contextPatch.stage, 'node0_awaiting_backfill');
    assert.equal(handoff.contextPatch.profile.bookingStatus, 'link_sent');
    assert.match(handoff.replyText, /guidexpert\.co\.in\/one-on-one-session/);
    assert.match(handoff.replyText, /preference/i);
    assert.equal(handoff.interactive.type, 'button');
    assert.deepEqual(
      handoff.interactive.buttons.map((b) => b.title),
      ['Placements', 'AI & future tech', 'Affordable & safe']
    );
  });

  test('Some other time → website URL without slot hint', () => {
    const handoff = handleNode0SlotReply(
      { flowV2: { profile: emptyFlowV2Profile(), hybridSlotOffers: [] } },
      OTHER_TIME_ROW_ID
    );
    assert.equal(handoff.replyText, buildHybridWebsiteHandoffMessage({ preferredSlotLabel: null }));
    assert.equal(handoff.replyText, BOOKING_LINK_MESSAGE);
    assert.equal(handoff.contextPatch.profile.bookingStatus, 'link_sent');
  });

  test('does not clobber existing profile data when merging', async (t) => {
    mockLiveSlots(t, []);
    const existing = { ...emptyFlowV2Profile(), branchInterest: 'CSE', cityPref: 'Hyderabad' };
    const result = await handleNode0Override({ flowV2: { profile: existing } }, 'call me');
    assert.equal(result.contextPatch.profile.branchInterest, 'CSE');
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
  });

  test('defaults to an empty profile when ctx.flowV2 is entirely absent (fresh conversation)', async (t) => {
    mockLiveSlots(t, []);
    const result = await handleNode0Override({}, 'book');
    assert.equal(result.contextPatch.profile.bookingStatus, 'booking_started');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_slot');
  });
});

describe('flowV2 Node 0 override — pre-empts stage routing at the dispatcher level', () => {
  test('fires from a completely fresh conversation (stage = null) into hybrid slot picker', async (t) => {
    mockLiveSlots(t, []);
    const result = await processFlowV2Turn({}, 'talk to a person please');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_slot');
    assert.equal(result.interactive.type, 'list');
    assert.match(result.interactive.body, /When suits you/);
  });

  test('fires mid-greeting-reply, pre-empting the greeting reply handler', async (t) => {
    mockLiveSlots(t, []);
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'actually, can you call me instead');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_slot');
    assert.equal(result.interactive.type, 'list');
  });

  test('node0_awaiting_slot routes to slot reply → website URL + backfill', async (t) => {
    mockLiveSlots(t, [
      { id: 'slotZ', slotDate: istTodayYmd(), slotTime: '5:00 PM', bookingClosed: false },
    ]);
    const linkTurn = await processFlowV2Turn({}, 'book a session');
    assert.equal(linkTurn.contextPatch.stage, 'node0_awaiting_slot');

    const slotTurn = await processFlowV2Turn(
      {
        flowV2: {
          stage: linkTurn.contextPatch.stage,
          profile: linkTurn.contextPatch.profile,
          hybridSlotOffers: linkTurn.contextPatch.hybridSlotOffers,
        },
      },
      OTHER_TIME_ROW_ID
    );

    assert.equal(slotTurn.contextPatch.stage, 'node0_awaiting_backfill');
    assert.match(slotTurn.replyText, /guidexpert\.co\.in\/one-on-one-session/);
    assert.equal(slotTurn.contextPatch.profile.bookingStatus, 'link_sent');
  });

  test('NEW SCOPE: a backfill answer writes the canonical goalPriority slot and enters B7 awaiting-Done without re-sending the link', async (t) => {
    mockLiveSlots(t, []);
    const pickerTurn = await processFlowV2Turn({}, 'book a session');
    const linkTurn = await processFlowV2Turn(
      {
        flowV2: {
          stage: pickerTurn.contextPatch.stage,
          profile: pickerTurn.contextPatch.profile,
          hybridSlotOffers: pickerTurn.contextPatch.hybridSlotOffers,
        },
      },
      OTHER_TIME_ROW_ID
    );
    const backfillTurn = await processFlowV2Turn(
      {
        flowV2: {
          stage: linkTurn.contextPatch.stage,
          profile: linkTurn.contextPatch.profile,
        },
      },
      'AI & future tech'
    );

    assert.deepEqual(backfillTurn.contextPatch.profile.goalPriority, ['ai_future_tech']);
    assert.equal(backfillTurn.contextPatch.profile.bookingStatus, 'link_sent');
    assert.equal(backfillTurn.contextPatch.stage, 'b7_awaiting_done');
    assert.doesNotMatch(backfillTurn.replyText || '', /guidexpert\.co\.in\/one-on-one-session/);
  });

  test('optional backfill may be skipped with Done and reuses B7 completion/helper mode', async (t) => {
    mockLiveSlots(t, []);
    const pickerTurn = await processFlowV2Turn({}, 'connect me');
    const linkTurn = await processFlowV2Turn(
      {
        flowV2: {
          stage: pickerTurn.contextPatch.stage,
          profile: pickerTurn.contextPatch.profile,
          hybridSlotOffers: pickerTurn.contextPatch.hybridSlotOffers,
        },
      },
      OTHER_TIME_ROW_ID
    );
    const doneTurn = await processFlowV2Turn(
      { flowV2: { stage: linkTurn.contextPatch.stage, profile: linkTurn.contextPatch.profile } },
      'Done'
    );

    assert.equal(doneTurn.contextPatch.profile.bookingStatus, 'done');
    assert.equal(doneTurn.contextPatch.stage, 'b7_post_booking');
    assert.match(doneTurn.replyText, /request is in/i);
  });

  test('repeating booking language while awaiting optional backfill does not send the URL twice', async (t) => {
    mockLiveSlots(t, []);
    const pickerTurn = await processFlowV2Turn({}, 'book');
    const linkTurn = await processFlowV2Turn(
      {
        flowV2: {
          stage: pickerTurn.contextPatch.stage,
          profile: pickerTurn.contextPatch.profile,
          hybridSlotOffers: pickerTurn.contextPatch.hybridSlotOffers,
        },
      },
      OTHER_TIME_ROW_ID
    );
    const repeatTurn = await processFlowV2Turn(
      { flowV2: { stage: linkTurn.contextPatch.stage, profile: linkTurn.contextPatch.profile } },
      'book'
    );

    assert.equal(repeatTurn.contextPatch.stage, 'b7_awaiting_done');
    assert.doesNotMatch(repeatTurn.replyText || '', /guidexpert\.co\.in\/one-on-one-session/);
  });
});
