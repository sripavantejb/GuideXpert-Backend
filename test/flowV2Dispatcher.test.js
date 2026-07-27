'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const {
  handleCoreForkExitEntry,
  EXIT_MESSAGE_1,
  EXIT_MESSAGE_2,
  EXIT_MESSAGE_3,
  EXIT_MESSAGE_4,
  EXIT_BUTTONS,
} = require('../services/chatbot/flowV2/nodes/b2CoreForkExit');
const handoffService = require('../services/chatbot/handoffService');
const WhatsAppAgentHandoff = require('../models/WhatsAppAgentHandoff');

const FULL_GREETING_MARKER = "I'm Guide, from GuideXpert's counselling desk";

describe('flowV2Dispatcher — stage routing', () => {
  test('a fresh conversation (no stage) routes to the full greeting entry', async () => {
    const result = await processFlowV2Turn({}, 'hi');
    assert.match(result.replyText, new RegExp(FULL_GREETING_MARKER));
    assert.equal(result.contextPatch.stage, 'greeting_awaiting_reply');
  });

  test("stage === 'greeting_awaiting_reply' routes to the reply handler, NOT the entry handler", async () => {
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, '12th mpc');
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
  });
});

describe('flowV2Dispatcher — never sends the full greeting twice (proven at the dispatcher level)', () => {
  test('once stage is any non-null value, the full greeting text never appears again in a normal reply', async () => {
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, "I don't really know");
    assert.doesNotMatch(String(result.replyText || ''), new RegExp(FULL_GREETING_MARKER));
    assert.doesNotMatch(String(result.interactive?.body || ''), new RegExp(FULL_GREETING_MARKER));
  });

  test('once stage is set, even an override-triggering message never routes back through the full greeting', async () => {
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'human please');
    assert.doesNotMatch(String(result.replyText || ''), new RegExp(FULL_GREETING_MARKER));
    assert.equal(result.contextPatch.stage, 'node0_awaiting_backfill');
  });
});

describe('flowV2Dispatcher — Node 0 pre-empts every stage, checked before any stage routing', () => {
  test('pre-empts a fresh conversation (stage = null)', async () => {
    const result = await processFlowV2Turn({}, 'book a session');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_backfill');
  });

  test('pre-empts mid-greeting-reply (stage = greeting_awaiting_reply)', async () => {
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'connect me with a counsellor');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_backfill');
  });
});

describe('flowV2Dispatcher — unrecognized (future-phase) stages fall back safely', () => {
  test('a stage with no handler yet (e.g. node0_awaiting_backfill) does not throw/reject and returns a safe generic reply', async () => {
    const ctx = { flowV2: { stage: 'node0_awaiting_backfill', profile: emptyFlowV2Profile() } };
    // ASYNC (Phase 8): processFlowV2Turn now returns a Promise, so a bad
    // stage would surface as a REJECTION, not a synchronous throw —
    // assert.doesNotThrow would silently pass even if this actually threw
    // inside the async function. assert.doesNotReject is the correct async
    // equivalent.
    await assert.doesNotReject(() => processFlowV2Turn(ctx, 'Placements'));
    const result = await processFlowV2Turn(ctx, 'Placements');
    assert.equal(typeof result.replyText, 'string');
    assert.equal(result.nextState, 'career_counselling_flow_v2');
  });
});

/**
 * ASYNC CONVERSION REGRESSION (Phase 8 checkpoint, requested explicitly):
 * making `processFlowV2Turn` `async` is only a safe no-op for B1-B7's
 * still-synchronous handlers if `await`ing their return value produces the
 * exact same value/reference as calling them directly — true for scalars
 * and plain objects by the language spec (a non-thenable value passed
 * through `await` resolves to that same value), but worth proving
 * directly for the two shapes in this codebase least obviously safe by
 * inspection alone: a multi-message array (`replyParts`, plus a nested
 * `interactive.buttons` array) and an object carrying a nested, still-
 * callable function reference (`pendingSideEffect.execute`).
 */
describe('flowV2Dispatcher — async conversion (Phase 8): multi-message/nested-function return shapes are unaffected by awaiting a still-synchronous handler', () => {
  test('b2CoreForkExit\u2019s 4-message F2 exit sequence survives the async dispatcher byte-for-byte identical to a direct, synchronous handler call', async () => {
    const directProfile = { ...emptyFlowV2Profile(), coreInterest: 'mechanical', coreBridgeAttempted: true, branchInterest: 'Mechanical' };
    // Baseline: call the still-fully-synchronous node function directly,
    // with no dispatcher and no `await` anywhere in the call chain.
    const directResult = handleCoreForkExitEntry({ flowV2: { profile: directProfile } });

    // Same inputs, but THROUGH the now-async dispatcher (processFlowV2Turn
    // -> runStageFallthrough -> handleCoreForkReply -> handleCoreForkExitEntry,
    // every hop now `await`ed).
    const ctx = { flowV2: { stage: 'b2_core_fork_awaiting_reply', profile: directProfile } };
    const viaDispatcher = await processFlowV2Turn(ctx, 'I want pure mechanical');

    // 1. The array itself: same length, same order, same content — proven
    // against both the known constants AND the direct-call baseline.
    assert.deepEqual(viaDispatcher.replyParts, [EXIT_MESSAGE_1, EXIT_MESSAGE_2, EXIT_MESSAGE_3]);
    assert.deepEqual(viaDispatcher.replyParts, directResult.replyParts);

    // 2. The nested interactive object (a 4th message hiding in
    // `interactive.body`) plus its own nested `buttons` array — proven the
    // same way.
    assert.equal(viaDispatcher.interactive.body, EXIT_MESSAGE_4);
    assert.deepEqual(viaDispatcher.interactive.buttons, EXIT_BUTTONS);
    assert.deepEqual(viaDispatcher.interactive, directResult.interactive);

    // 3. Sanity: this is genuinely the multi-message shape, not an
    // accidental single-string collapse introduced by the conversion.
    assert.equal(viaDispatcher.replyParts.length, 3);
    assert.equal(viaDispatcher.interactive.buttons.length, 2);
  });

  test('R7 Tier-2\u2019s pendingSideEffect (a nested function reference) survives the async dispatcher and is still genuinely callable afterwards', async (t) => {
    const createHandoffMock = t.mock.method(handoffService, 'createHandoff', async () => ({ _id: 'async-boundary-ticket' }));
    t.mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({}));

    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'my life is over');

    // The side effect already fired once, eagerly, during the handler's
    // own synchronous portion (see flowV2CrisisLock.test.js for that
    // guarantee in isolation) — this test's job is different: prove the
    // RETURNED pendingSideEffect descriptor itself, after crossing the
    // outer `await` boundary, still has the exact shape and is still a
    // live, working function — not stripped, not stubbed, not turned into
    // a resolved value or a plain object by the trip through `await`.
    assert.equal(result.pendingSideEffect.type, 'crisis_handoff');
    assert.equal(typeof result.pendingSideEffect.execute, 'function');

    createHandoffMock.mock.resetCalls();
    const manualReplay = await result.pendingSideEffect.execute();
    assert.equal(createHandoffMock.mock.callCount(), 1, 'the function reference must still be genuinely callable post-await, not a dead/inert copy');
    assert.equal(manualReplay.handoffId, 'async-boundary-ticket');
  });
});
