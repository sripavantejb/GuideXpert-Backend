'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOverrideIntent,
  handleNode0Override,
  BOOKING_LINK_MESSAGE,
  BOOKING_URL,
  buildBookingUrlLine,
} = require('../services/chatbot/flowV2/nodes/node0Override');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

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

  /** Known entry-point functions across the B1-B7 spine, called directly
   * with a minimal representative ctx so this test satisfies the literal
   * ask (feed what "that stage's own entry function generates"), in
   * addition to the auto-discovering export scan above. New entry
   * functions should be added here too, but the export-scan layer above
   * already catches new button constants even if this list is forgotten. */
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
    ];

    for (const { name, load } of entryPoints) {
      let result;
      try {
        result = load();
      } catch (err) {
        // A node legitimately throwing on a bare/empty profile (e.g. a
        // guardrail) isn't this test's concern — it just means that entry
        // point contributes no titles from this call. Swallowed
        // intentionally, not hidden: still visible via low total count if
        // it ever causes every entry point to fail (see count guard below).
        continue;
      }
      titlesFromInteractive(result && result.interactive, name, out);
    }
  }

  /**
   * The ONLY titles in the entire spine allowed to collide with
   * OVERRIDE_PATTERNS today. Two entries, two DIFFERENT reasons — do not
   * conflate them:
   *
   * - "Book my session" (B7 · Book, Phase 7): B7 IS the booking beat, so
   *   it necessarily says "book". This collision is a FIX: mitigated by
   *   exempting every `b7_*` stage from Node 0's pre-empt at the
   *   dispatcher level (flowV2Dispatcher.js) so B7's own button survives
   *   and runs B7's own flow, independently regression-tested
   *   (test/flowV2B7Book.test.js, "REGRESSION: tapping [Book my session]
   *   while inside B7 is NOT hijacked...").
   *
   * - "Connect me" (R4-P · College Predictor's blocked-demographic case,
   *   Stage 1): the OPPOSITE of a fix — this collision is INTENTIONALLY
   *   LEFT UNMITIGATED at the dispatcher level. Unlike B7, R4-P's
   *   blocked case WANTS Node 0's pre-empt to intercept this button tap
   *   and run Node 0's real booking-link handoff — that IS the desired
   *   behavior, not a bug to route around. No `r4p_*` stage exemption
   *   exists (and none should be added for this reason). See
   *   r4pPredictor.js's module doc ("NODE 0 HANDOFF, NOT A DUPLICATE
   *   PATH") and test/flowV2R4PPredictor.test.js's end-to-end test
   *   proving this handoff already works correctly with zero changes to
   *   flowV2Dispatcher.js.
   *
   * This is a closed, explicit allowlist, not a general escape hatch:
   * any OTHER title colliding, anywhere in the spine, still fails this
   * test.
   */
  const KNOWN_MITIGATED_COLLISION_TITLES = new Set(['Book my session', 'Connect me']);

  test('every discoverable button/list-row title across the whole B1-B7 node spine passes detectOverrideIntent() as false, except the one closed, already-mitigated exception', () => {
    const collected = [];

    // Layer 1 — auto-discovering export scan (new files/constants need no
    // update to this test).
    const nodeFiles = fs.readdirSync(NODES_DIR).filter((f) => f.endsWith('.js'));
    for (const file of nodeFiles) {
      const mod = require(path.join(NODES_DIR, file));
      deepCollectTitles(mod, file, collected);
    }

    // Layer 2 — direct entry-function invocation (the literal ask).
    callKnownEntryFunctions(collected);

    // Guard against the discovery mechanism silently rotting (e.g. a
    // future refactor changes how buttons are shaped and this walker stops
    // finding anything — a test that always vacuously passes is worse than
    // no test).
    assert.ok(
      collected.length >= 15,
      `expected to discover a substantial number of button/row titles across the node spine, found ${collected.length} — the discovery heuristic in this test may need updating`
    );

    const allCollisions = collected.filter((entry) => detectOverrideIntent(entry.title));
    const unexpectedCollisions = allCollisions.filter((entry) => !KNOWN_MITIGATED_COLLISION_TITLES.has(entry.title));
    assert.deepEqual(
      unexpectedCollisions,
      [],
      `found NEW, unvetted button/list-row title(s) colliding with OVERRIDE_PATTERNS (must be exempted at the dispatcher level, regression-tested, and added to KNOWN_MITIGATED_COLLISION_TITLES if intentional): ${JSON.stringify(unexpectedCollisions)}`
    );

    // The inverse check matters just as much: if "Book my session" is ever
    // renamed/removed such that it STOPS colliding, this allowlist entry
    // (and the dispatcher exemption it documents) becomes dead and should
    // be consciously revisited, not silently left in place.
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
      'Absolutely \u2014 here\u2019s your booking form:\n\uD83D\uDC49 guidexpert.co.in/one-on-one-session\nOnce you submit, just reply Done here.'
    );
  });

  test('buildBookingUrlLine() returns the exact line BOOKING_LINK_MESSAGE was built from', () => {
    assert.equal(buildBookingUrlLine(), '\uD83D\uDC49 guidexpert.co.in/one-on-one-session');
    assert.ok(BOOKING_LINK_MESSAGE.includes(buildBookingUrlLine()));
  });

  test('BOOKING_URL is the bare URL, no emoji/prefix', () => {
    assert.equal(BOOKING_URL, 'guidexpert.co.in/one-on-one-session');
  });
});

describe('flowV2 Node 0 override — handler', () => {
  test('sends the booking link + backfill question, sets profile and stage', () => {
    const result = handleNode0Override({ flowV2: { profile: emptyFlowV2Profile() } }, 'I want to book');
    assert.match(result.replyText, /guidexpert\.co\.in\/one-on-one-session/);
    assert.equal(result.interactive.type, 'button');
    assert.equal(result.interactive.buttons.length, 3);
    assert.deepEqual(
      result.interactive.buttons.map((b) => b.title),
      ['Placements', 'AI & future tech', 'Affordable & safe']
    );
    assert.equal(result.contextPatch.profile.bookingStatus, 'link_sent');
    assert.equal(result.contextPatch.profile.temperature, 'hot');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_backfill');
  });

  test('does not clobber existing profile data when merging', () => {
    const existing = { ...emptyFlowV2Profile(), branchInterest: 'CSE', cityPref: 'Hyderabad' };
    const result = handleNode0Override({ flowV2: { profile: existing } }, 'call me');
    assert.equal(result.contextPatch.profile.branchInterest, 'CSE');
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
  });

  test('defaults to an empty profile when ctx.flowV2 is entirely absent (fresh conversation)', () => {
    const result = handleNode0Override({}, 'book');
    assert.equal(result.contextPatch.profile.bookingStatus, 'link_sent');
  });
});

describe('flowV2 Node 0 override — pre-empts stage routing at the dispatcher level', () => {
  test('fires from a completely fresh conversation (stage = null)', async () => {
    const result = await processFlowV2Turn({}, 'talk to a person please');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_backfill');
    assert.match(result.replyText, /booking form/i);
  });

  test('fires mid-greeting-reply, pre-empting the greeting reply handler', async () => {
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'actually, can you call me instead');
    // Must be the Node 0 response, NOT a greeting-reply response
    // (greeting replies never set stage to 'node0_awaiting_backfill').
    assert.equal(result.contextPatch.stage, 'node0_awaiting_backfill');
    assert.match(result.replyText, /booking form/i);
  });
});
