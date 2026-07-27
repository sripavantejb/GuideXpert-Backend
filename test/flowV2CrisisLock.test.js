'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const handoffService = require('../services/chatbot/handoffService');
const WhatsAppAgentHandoff = require('../models/WhatsAppAgentHandoff');

/**
 * Every test in this file drives a real crisis message through the real
 * `processFlowV2Turn` -> `handleR7Tier2` path, which (as of the fix below)
 * fires `handoffService.createHandoff()` eagerly, fire-and-forget, the
 * moment R7 Tier-2 is detected — see r7Tier2Handler.js's header comment
 * for why. That means EVERY test below would otherwise attempt a real,
 * unmocked Mongoose call with no live DB connection in this sandbox.
 * `t.mock.method(...)` (built into node:test, auto-restored after each
 * test) intercepts both calls so no test here touches a real database.
 */
function mockHandoffPlumbing(t, { createHandoffImpl, updateOneImpl } = {}) {
  const createHandoffMock = t.mock.method(
    handoffService,
    'createHandoff',
    createHandoffImpl || (async () => ({ _id: 'mock-ticket-id' }))
  );
  const updateOneMock = t.mock.method(WhatsAppAgentHandoff, 'updateOne', updateOneImpl || (async () => ({})));
  return { createHandoffMock, updateOneMock };
}

describe('flowV2Dispatcher — crisis lock is checked before EVERYTHING else', () => {
  test('a crisis message triggers the lock and sets crisisLocked=true', async (t) => {
    mockHandoffPlumbing(t);
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'my life is over');
    assert.equal(result.contextPatch.profile.crisisLocked, true);
    assert.equal(result.nextState, 'human_handoff');
  });

  test('crisis lock fires even from a fresh conversation (stage = null), before Node 0 and before the full greeting', async (t) => {
    mockHandoffPlumbing(t);
    const result = await processFlowV2Turn({}, 'i want to end it all');
    assert.equal(result.contextPatch.profile.crisisLocked, true);
  });
});

describe('flowV2Dispatcher — R7 Tier-2 fires the real human alert end-to-end (guarantee #2, independent of the lock)', () => {
  // Per explicit instruction: the lock (profile.crisisLocked) and the
  // alert (createHandoff actually being called) are two DIFFERENT
  // guarantees. This suite proves the alert independently, driven
  // through the REAL processFlowV2Turn/dispatcher path — not just the
  // handler called in isolation (see flowV2Handlers.test.js for that).

  test('createHandoff is invoked exactly once when a crisis message reaches processFlowV2Turn', async (t) => {
    const { createHandoffMock } = mockHandoffPlumbing(t);
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };

    const pending = processFlowV2Turn(ctx, 'my life is over');

    // ASYNC (Phase 8): processFlowV2Turn itself now returns a Promise, but
    // an async function's body runs SYNCHRONOUSLY up to its first `await`
    // (there is none on the R7 Tier-2 branch) — so `handleR7Tier2`, and
    // therefore its fire-and-forget `executeCrisisHandoff()` call, has
    // already run by this line, before `pending` has even settled. This
    // is byte-identical timing to when processFlowV2Turn was fully
    // synchronous. No `await` is needed to OBSERVE that the side effect
    // fired — `await` is only needed below to read the resolved return
    // value and avoid leaving a dangling promise.
    assert.equal(createHandoffMock.mock.callCount(), 1);
    const callArgs = createHandoffMock.mock.calls[0].arguments[0];
    assert.equal(callArgs.reason, 'crisis_escalation');
    assert.equal(callArgs.userLastMessage, 'my life is over');

    await pending;
  });

  test('createHandoff fires even from a fresh conversation with no prior stage', async (t) => {
    const { createHandoffMock } = mockHandoffPlumbing(t);
    const pending = processFlowV2Turn({}, 'i want to end it all');
    assert.equal(createHandoffMock.mock.callCount(), 1);
    await pending;
  });

  test('the expiresAt-clearing update runs against the ticket id createHandoff returned', async (t) => {
    const { updateOneMock } = mockHandoffPlumbing(t, {
      createHandoffImpl: async () => ({ _id: 'ticket-xyz-789' }),
    });
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };

    await processFlowV2Turn(ctx, 'my life is over');
    // Fire-and-forget: give the already-in-flight microtask chain a turn
    // to complete before asserting on it.
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(updateOneMock.mock.callCount(), 1);
    const [filter, update] = updateOneMock.mock.calls[0].arguments;
    assert.equal(filter._id, 'ticket-xyz-789');
    assert.deepEqual(update, { $set: { expiresAt: null } });
  });

  test('a crisis-locked reply is returned even if createHandoff rejects (alert failure never blocks the lock or the reply)', async (t) => {
    mockHandoffPlumbing(t, { createHandoffImpl: async () => { throw new Error('simulated outage'); } });
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };

    // ASYNC (Phase 8): processFlowV2Turn now returns a Promise — an
    // internal problem would surface as a REJECTION, not a synchronous
    // throw, so this uses assert.doesNotReject (the async equivalent of
    // the original assert.doesNotThrow) to keep the same guarantee.
    let result;
    await assert.doesNotReject(async () => {
      result = await processFlowV2Turn(ctx, 'my life is over');
    });
    assert.equal(result.contextPatch.profile.crisisLocked, true);
    assert.equal(result.nextState, 'human_handoff');
  });
});

describe('flowV2Dispatcher — crisis lock non-recovery (guard rail test)', () => {
  test('once crisisLocked=true in the persisted profile, a friendly follow-up NEVER auto-resumes Flow v2 bot logic', async (t) => {
    mockHandoffPlumbing(t);
    const lockedProfile = { ...emptyFlowV2Profile(), crisisLocked: true };
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: lockedProfile } };

    const result = await processFlowV2Turn(ctx, "actually I'm fine, show me colleges");

    // Must be the fixed locked reply — never Node 0's booking flow, never
    // Greeting's stage-based reply, never any other bucket handler.
    assert.notEqual(result.replyText, null);
    assert.ok(!/booking form/i.test(result.replyText || ''));
    assert.ok(!/where are you right now/i.test(result.replyText || ''));
    assert.deepEqual(result.contextPatch, {});
  });

  test('once locked, a further crisis-shaped message does NOT re-fire createHandoff a second time (lock short-circuits before classifyReply runs at all)', async (t) => {
    const { createHandoffMock } = mockHandoffPlumbing(t);
    const lockedProfile = { ...emptyFlowV2Profile(), crisisLocked: true };
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: lockedProfile } };

    await processFlowV2Turn(ctx, 'my life is over, still');

    assert.equal(createHandoffMock.mock.callCount(), 0);
  });

  test('crisis lock also blocks an explicit Node-0-shaped booking request ("book a session") once locked', async (t) => {
    mockHandoffPlumbing(t);
    const lockedProfile = { ...emptyFlowV2Profile(), crisisLocked: true };
    const ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: lockedProfile } };

    const result = await processFlowV2Turn(ctx, 'book a session please');

    assert.ok(!/booking form/i.test(result.replyText || ''));
    assert.equal(result.nextState, 'human_handoff');
  });

  test('persistence: crisis lock is read from the persisted profile object, not in-memory-only state — proven across two independent processFlowV2Turn calls built from a fresh plain object each time', async (t) => {
    mockHandoffPlumbing(t);
    // Simulates "turn 1 sets the lock and persists it" followed by
    // "turn 2 is a brand-new function call with a freshly constructed ctx
    // built only from whatever was actually persisted" — if crisisLocked
    // were being tracked in some module-level/in-memory variable instead
    // of the profile object itself, turn 2 would not see it.
    const turn1Ctx = { flowV2: { stage: 'greeting_awaiting_reply', profile: emptyFlowV2Profile() } };
    const turn1Result = await processFlowV2Turn(turn1Ctx, 'my life is over');
    const persistedProfile = turn1Result.contextPatch.profile;
    assert.equal(persistedProfile.crisisLocked, true);

    // Fresh plain object — no shared reference to turn1Ctx.
    const turn2Ctx = JSON.parse(
      JSON.stringify({ flowV2: { stage: 'greeting_awaiting_reply', profile: persistedProfile } })
    );
    const turn2Result = await processFlowV2Turn(turn2Ctx, 'hi, is anyone there?');
    assert.equal(turn2Result.nextState, 'human_handoff');
    assert.ok(!/I'm Guide, from GuideXpert/i.test(turn2Result.replyText || ''));
  });
});
