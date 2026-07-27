'use strict';

/**
 * Flow v2 — R7 Tier-2 handler (genuine distress / self-harm signals).
 *
 * HARD STOP. This is the single highest-priority path in all of Flow v2.
 * When `classifyReply` returns `{ bucket: 'R7', tier: 2 }`, this handler:
 *   1. Sends the fixed crisis-response line verbatim (never paraphrased).
 *   2. Sets `profile.crisisLocked = true` — checked by `flowV2Dispatcher`
 *      BEFORE Node 0, BEFORE classifyReply, BEFORE anything else, on every
 *      future turn for this conversation. This is what makes the lock
 *      unrecoverable by Flow v2 bot logic (see flowV2Dispatcher.js).
 *   3. FIRES the real, DB-backed `WhatsAppAgentHandoff` ticket creation
 *      ITSELF, immediately, right here — it does NOT wait for some future
 *      caller to remember to run it.
 *
 * WHY this changed from the original design: `processFlowV2Turn` was
 * verified to have ZERO call sites anywhere outside test files — Flow v2
 * has never been wired into any live message-send pipeline. The original
 * design returned an un-executed `pendingSideEffect.execute` for "whoever
 * wires Flow v2 live" to await — but there is no guarantee anyone ever
 * does that at the same time Flow v2 goes live, and this is the single
 * most safety-critical path in the whole system. It must not depend on a
 * future integration step being remembered. So the side effect now fires
 * eagerly, right here, the moment this handler runs — in test, in a
 * future live pipeline, in any context — with no external plumbing
 * required.
 *
 * HOW this stays synchronous without blocking: `processFlowV2Turn`'s
 * contract (plain-object return, not a Promise) is unchanged — Node 0 and
 * Greeting remain fully synchronous. `executeCrisisHandoff()` (an async
 * function) is invoked here WITHOUT `await` ("fire and forget") — the
 * Node.js event loop runs it to completion in the background regardless
 * of whether the caller awaits it, as long as the process stays alive
 * (true for a running server). A `.catch()` prevents an unhandled-
 * rejection crash and logs failures. `createHandoff()` is itself
 * idempotent (returns the existing open/claimed ticket for this
 * conversation if one already exists), so firing it eagerly is safe even
 * if this handler were somehow invoked more than once.
 *
 * `handoffService` and `WhatsAppAgentHandoff` are required as-is (not
 * modified) — swap them via `deps` (2nd arg to `buildCrisisHandoffSideEffect`,
 * exported for tests) to verify the call without touching a real database.
 *
 * TODO(live-wiring): the general orchestrator's `cancelActiveHandoffForUser`
 * (services/chatbot/handoffService.js) resumes ordinary bot menu behavior
 * on "MENU", regardless of handoff reason. This is a known limitation for
 * the *orchestrator's* own pause mechanism (not Flow v2's own crisisLocked
 * check, which is independent, already fires unconditionally, and is
 * unaffected) — flagged here for whoever wires Flow v2 into the live
 * orchestrator, not solved in this phase.
 */

const defaultHandoffService = require('../../../handoffService');
const defaultWhatsAppAgentHandoff = require('../../../../../models/WhatsAppAgentHandoff');
const { mergeFlowV2Profile } = require('../../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../../constants/careerCounsellingFlowV2Profile');

const CRISIS_RESPONSE_TEXT = [
  "I'm really glad you told me that, and I don't want to move past it. A result doesn't decide your worth, whatever it feels like today. Please talk to someone you trust right now — a parent, a teacher, a friend.",
  "And if it's heavier than that, Tele-MANAS is free and available 24/7 on 14416. I'm connecting you with one of our counsellors — a real person — right away.",
].join(' ');

/**
 * Builds the real handoff-ticket side effect (does not execute it).
 * @param {object} ctx
 * @param {string} text - the crisis message itself, stored as userLastMessage
 * @param {{ createHandoff?: Function, WhatsAppAgentHandoff?: object }} [deps] - injectable for tests
 * @returns {() => Promise<{ handoffId: string }>}
 */
function buildCrisisHandoffSideEffect(ctx, text, deps = {}) {
  const createHandoff = deps.createHandoff || defaultHandoffService.createHandoff;
  const AgentHandoffModel = deps.WhatsAppAgentHandoff || defaultWhatsAppAgentHandoff;

  return async function executeCrisisHandoff() {
    const conversation = ctx?.conversation || { _id: ctx?.conversationId, phone: ctx?.phone };
    const handoff = await createHandoff({
      conversation,
      leadContext: ctx?.leadContext || {},
      reason: 'crisis_escalation',
      userLastMessage: text,
      createdBy: 'bot',
    });
    // Never let this ticket auto-expire via expireStaleHandoffs' 4h sweep
    // (query is `expiresAt: { $lte: now }`; null never matches).
    await AgentHandoffModel.updateOne({ _id: handoff._id }, { $set: { expiresAt: null } });
    return { handoffId: String(handoff._id) };
  };
}

/**
 * @param {object} ctx
 * @param {string} text
 * @param {{ createHandoff?: Function, WhatsAppAgentHandoff?: object, onSideEffectError?: Function }} [deps] - injectable for tests
 * @returns {object} standard Flow v2 node return shape, plus `pendingSideEffect`
 */
function handleR7Tier2(ctx, text, deps = {}) {
  const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const mergedProfile = mergeFlowV2Profile(currentProfile, {
    crisisLocked: true,
  });

  const executeCrisisHandoff = buildCrisisHandoffSideEffect(ctx, text, deps);

  // Fire it NOW — do not wait for some future caller to remember to.
  // Errors are caught and logged, never thrown into the synchronous
  // caller (processFlowV2Turn must never become a Promise).
  const onSideEffectError =
    deps.onSideEffectError ||
    ((err) => {
      // eslint-disable-next-line no-console
      console.error('[flowV2] R7 Tier-2 crisis handoff side effect failed', err);
    });
  executeCrisisHandoff().catch(onSideEffectError);

  return {
    replyText: CRISIS_RESPONSE_TEXT,
    replyParts: null,
    interactive: null,
    contextPatch: {
      profile: mergedProfile,
    },
    nextState: 'human_handoff',
    intent: 'career_counselling_flow_v2',
    // Retained for introspection/idempotent manual re-trigger — the real
    // side effect has ALREADY been fired above, this is not "pending".
    pendingSideEffect: {
      type: 'crisis_handoff',
      execute: executeCrisisHandoff,
    },
  };
}

module.exports = {
  handleR7Tier2,
  CRISIS_RESPONSE_TEXT,
  buildCrisisHandoffSideEffect,
};
