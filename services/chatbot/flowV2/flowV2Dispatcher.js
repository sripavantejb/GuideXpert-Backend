'use strict';

/**
 * Flow v2 — dispatcher.
 *
 * `processFlowV2Turn(ctx, inboundMessage, meta)` is the entry point intended
 * to be called whenever `WhatsAppBotState.state === 'career_counselling_flow_v2'`.
 * Not yet wired into any live orchestrator/registry call site in this
 * phase — this file (and the nodes/handlers it routes to) are unit-tested
 * directly.
 *
 * ASYNC since Phase 8: `processFlowV2Turn` is an `async function` and
 * returns a `Promise` — every caller (including every test) must
 * `await` it. This was converted deliberately, ahead of and in
 * preparation for R4-P (the real-API college predictor node, which must
 * await a genuine network call to produce its reply), while Phase 3's
 * finding still held that this function had zero production call sites —
 * see the dedicated comment on the function itself for the full
 * reasoning and the old (pre-Flow-v2) predictor flow's async pattern this
 * mirrors. B1-B7's own node files remain fully synchronous internally;
 * only this dispatcher's own signature changed.
 *
 * When Flow v2 is eventually plugged into a real conversation,
 * the caller is expected to build `ctx` from the persisted `context.flowV2`
 * sub-object and apply the returned `contextPatch` back onto that same
 * sub-object (never the top-level `context`), and to translate the
 * returned `interactive` descriptor into a call to `sendBotListReply` /
 * `sendBotButtonReply` (see services/chatbot/whatsappOutboundService.js) —
 * `interactive` is already shaped to match those functions' arguments
 * (minus conversationId/phone/inReplyToInboundId, which the caller
 * supplies). If the returned shape includes `pendingSideEffect` (only
 * ever set by the R7 Tier-2 crisis handler), it has ALREADY been fired
 * (fire-and-forget) by the time this function returns — the live caller
 * MAY optionally await the same `pendingSideEffect.execute()` promise
 * again (idempotent) to persist the resulting `handoffId` back onto
 * `profile.crisisHandoffId`, but is not required to for the alert itself
 * to have fired — see router/handlers/r7Tier2Handler.js for why this
 * changed from an originally-deferred design.
 *
 * ctx shape (caller-supplied):
 * {
 *   conversationId, phone,
 *   conversation: object|null,   // full WhatsAppConversation doc — only
 *                                 // required if a crisis-lock side effect
 *                                 // will actually be executed; omit in tests
 *   flowV2: {
 *     stage: string|null, profile: object,
 *     pendingQualificationGuess: string|null,
 *     pendingAmbiguousResolution: { slot: string, partial: string }|null,
 *     compareMode: 'full'|'best_only'|null,   // Phase 6 — set by B5's
 *       // [Compare them]/[Just the best fit] buttons, read by B6 on the
 *       // very next turn to decide whether to send the comparison bubble.
 *       // Ephemeral per-turn routing data, same category as
 *       // pendingQualificationGuess above — NOT a LEAD_PROFILE_SCHEMA slot.
 *     changingSlot: string|null,   // Phase 6 — set by B5's "Change
 *       // something" sub-flow (b5_change_awaiting_value) to remember which
 *       // profile field the student is about to re-answer. Same ephemeral
 *       // category as compareMode above.
 *   },
 *   leadContext: { booking?: {fullName}, iit?: {fullName}, gx?: {fullName} } | null,
 * }
 *
 * meta (optional, Phase 3): { messageType?: string } — the inbound
 * WhatsApp message type (see constants/chatbotStates.js INBOUND_MESSAGE_TYPES).
 * Defaults to 'text' when omitted, matching how every Phase 1-2 caller
 * already behaves (message type never mattered before R9 existed).
 *
 * Return shape (every node function, including this dispatcher's own
 * fallback, uses this same shape):
 * {
 *   replyText: string|null,
 *   replyParts: string[]|null,
 *   interactive: null | { type:'list', body, buttonText, sections } | { type:'button', body, buttons },
 *   contextPatch: object,   // patches context.flowV2 only, never the top-level context
 *   nextState: 'career_counselling_flow_v2' | 'human_handoff',
 *   intent: 'career_counselling_flow_v2',
 *   pendingSideEffect?: { type: string, execute: () => Promise<object> },
 * }
 *
 * ROUTING ORDER (Phase 3, unchanged since): crisis-lock short-circuit >
 * Node 0 pre-empt > classifyReply() > 8 fully-wired bucket handlers (R5,
 * R6, R7 both tiers, R8, R9, R10, R11, R12) > R1-R4 fallthrough
 * (stage-based routing, now covering B1/B2/the core-fork and its exit
 * sub-flow as of Phase 4, B3 as of Phase 5, B5/B6 as of Phase 6, and B7 as
 * of Phase 7 — the full B1-B7 beat spine is now wired end to end) >
 * safeFallbackReply.
 */

const { detectOverrideIntent, handleNode0Override } = require('./nodes/node0Override');
const { handleGreetingEntry, handleGreetingReply } = require('./nodes/greeting');
const { handleB1Entry, handleB1Reply } = require('./nodes/b1Goal');
const { handleB2Reply } = require('./nodes/b2Branch');
const { handleCoreForkReply } = require('./nodes/b2CoreFork');
const { handleCoreForkExitReply } = require('./nodes/b2CoreForkExit');
const { handleB3Entry, handleB3Reply } = require('./nodes/b3Constraints');
const { handleB5Entry, handleB5Reply } = require('./nodes/b5Shortlist');
const { handleB6Entry } = require('./nodes/b6TheCase');
const { handleB7Entry, handleB7Reply } = require('./nodes/b7Book');
const { classifyReply } = require('./router/classifyReply');
const { mergeFlowV2Profile } = require('./flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../constants/careerCounsellingFlowV2Profile');

const { handleR7Tier2 } = require('./router/handlers/r7Tier2Handler');
const { getR7Tier1PrefixLine } = require('./router/handlers/r7Tier1Handler');
const { handleR5 } = require('./router/handlers/r5Handler');
const { handleR6 } = require('./router/handlers/r6Handler');
const { handleR8 } = require('./router/handlers/r8Handler');
const { handleR9 } = require('./router/handlers/r9Handler');
const { handleR10 } = require('./router/handlers/r10Handler');
const { handleR11 } = require('./router/handlers/r11Handler');
const { handleR12 } = require('./router/handlers/r12Handler');

/** Buckets fully owned by a router handler this phase — intercept and
 * return that handler's result directly (after doorHistory recording).
 * R7 is deliberately excluded here: Tier-2 hard-stops (handled inline,
 * before this map is even consulted) and Tier-1 is a prefix-then-fallthrough
 * hybrid (also handled inline) — neither fits the "return handler's result
 * directly" shape this map assumes. */
const WIRED_HANDLERS = Object.freeze({
  R5: handleR5,
  R6: handleR6,
  R8: handleR8,
  R9: handleR9,
  R10: handleR10,
  R11: handleR11,
  R12: handleR12,
});

const CRISIS_LOCKED_REPLY_TEXT =
  "You're already connected with one of our counsellors — they'll reply here as soon as they can.";

function crisisLockedReply() {
  return {
    replyText: CRISIS_LOCKED_REPLY_TEXT,
    replyParts: null,
    interactive: null,
    contextPatch: {},
    nextState: 'human_handoff',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * Minimal generic safety net for a stage no node routes yet — e.g.
 * 'node0_awaiting_backfill' (Node 0's own documented TODO, still unwired
 * — out of scope for this phase, unchanged from Phase 3), or 'parked_core'
 * (a genuine terminal state — reaching this fallback for it is itself the
 * guarantee that Flow v2 bot logic never auto-resumes past it).
 * Deliberately NOT a per-stage stub — just a generic, non-crashing
 * fallback. As of Phase 7, every B1-B7 beat stage has a real handler —
 * this is no longer standing in for an unbuilt beat.
 */
function safeFallbackReply() {
  return {
    replyText: "Let's continue from where we left off.",
    replyParts: null,
    interactive: null,
    contextPatch: {},
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/** Runs whatever stage-based routing would have run for this turn,
 * completely unchanged — the single call site shared by the R1-R4
 * fallthrough path and R7 Tier-1's "falls through" behavior.
 *
 * ASYNC (Phase 8 checkpoint): made `async` and every branch `await`ed
 * uniformly ahead of R4-P landing here — every B1-B7 handler below is
 * still genuinely synchronous today, so each `await` is a no-op (a
 * non-thenable value passed through `await` resolves to that exact same
 * value/reference — see the dedicated regression test in
 * test/flowV2Dispatcher.test.js proving this holds for the multi-message
 * array + nested-function-reference shapes too, not just plain objects).
 * This lets R4-P's stages be added here later as genuinely async branches
 * with zero further changes to the branches already listed. */
async function runStageFallthrough(ctx, stage, text) {
  if (!stage) return await handleGreetingEntry(ctx);
  if (stage === 'greeting_awaiting_reply') return await handleGreetingReply(ctx, text);
  // Phase 4 — B1 · Goal, B2 · Branch, and the B2.2 core-engineering fork
  // + its honest-exit sub-flow.
  if (stage === 'greeting_captured_pending_b1') return await handleB1Entry(ctx);
  if (stage === 'b1_awaiting_reply') return await handleB1Reply(ctx, text);
  if (stage === 'b2_awaiting_reply') return await handleB2Reply(ctx, text);
  if (stage === 'b2_core_fork_awaiting_reply') return await handleCoreForkReply(ctx, text);
  if (stage === 'b2_core_exit_awaiting_reply') return await handleCoreForkExitReply(ctx, text);
  // Phase 5 additions — B3 · Constraints.
  if (stage === 'b3_awaiting_entry') return await handleB3Entry(ctx);
  if (stage === 'b3_awaiting_budget') return await handleB3Reply(ctx, text);
  if (stage === 'b3_awaiting_location') return await handleB3Reply(ctx, text);
  // Phase 6 additions — B5 · Shortlist and B6 · The Case. B4 (Phase 5) sets
  // 'b5_awaiting_entry' and waits for the next turn (same precedent as B2's
  // advanceToB3, since B4 could not chain directly into a B5 that did not
  // exist yet when it was built) — wired here now that B5 exists for real.
  if (stage === 'b5_awaiting_entry') return await handleB5Entry(ctx);
  if (stage === 'b5_awaiting_reply') return await handleB5Reply(ctx, text);
  if (stage === 'b5_change_awaiting_slot') return await handleB5Reply(ctx, text);
  if (stage === 'b5_change_awaiting_value') return await handleB5Reply(ctx, text);
  if (stage === 'b6_awaiting_entry') return await handleB6Entry(ctx);
  // Phase 7 additions — B7 · Book, the final beat in the Flow v2 spine.
  // Reachable from B6's normal handoff today; the R4-G ("best college")
  // early-invite dispatcher wiring that would also reach B7 directly
  // (skipping B3/B4/B5/B6) is intentionally NOT built this phase — flagged
  // as a follow-up, not silently dropped. handleB7Entry already degrades
  // gracefully either way (does not assume profile.recommendation is set).
  if (stage === 'b7_awaiting_entry') return await handleB7Entry(ctx);
  if (stage === 'b7_awaiting_reply') return await handleB7Reply(ctx, text);
  if (stage === 'b7_awaiting_done') return await handleB7Reply(ctx, text);
  if (stage === 'b7_post_decline') return await handleB7Reply(ctx, text);
  if (stage === 'b7_post_booking') return await handleB7Reply(ctx, text);
  return safeFallbackReply();
}

/** Appends a doorHistory entry to whatever profile the handler's own
 * contextPatch already carries (or, if it didn't touch the profile, to
 * ctx's current profile) — the single place doorHistory recording happens,
 * so no handler needs to know about it itself. */
function withDoorHistory(result, ctx, bucket, stage) {
  const baseProfile = (result.contextPatch && result.contextPatch.profile) || ctx?.flowV2?.profile || emptyFlowV2Profile();
  const mergedProfile = mergeFlowV2Profile(baseProfile, {
    doorHistory: [{ bucket, stage, timestamp: Date.now() }],
  });
  return {
    ...result,
    contextPatch: { ...result.contextPatch, profile: mergedProfile },
  };
}

/**
 * ASYNC (Phase 8 checkpoint, converted ahead of R4-P): `processFlowV2Turn`
 * is now genuinely `async` and returns a Promise. This was a deliberate,
 * isolated architecture decision made BEFORE R4-P (the real-API college
 * predictor node) was built — R4-P must `await` a real network call
 * (`fetchCollegeDostColleges`) to produce its student-facing reply, and
 * Phase 3 confirmed `processFlowV2Turn` has ZERO production call sites
 * today (only unit tests call it), making this the cheapest possible time
 * to make the change, before any real caller depends on a synchronous
 * contract. The old (pre-Flow-v2) predictor chain
 * (`guidedFlowOrchestrator.js` → `guidedFlowProcessors.js` →
 * `collegePredictorChatService.js` → `fetchCollegeDostColleges`) was
 * checked first and confirmed to be `async`/`await` throughout, with no
 * sync/async boundary trick to mirror — this conversion simply matches
 * that same, already-proven-in-production pattern.
 *
 * Every call site of this function (all in test files as of this phase)
 * must now `await processFlowV2Turn(...)` from an `async` test callback.
 * B1-B7's own node files are UNCHANGED and remain synchronous — `await`
 * on a plain, non-thenable return value (a string, an object, an array of
 * strings, an object containing a nested function reference like R7
 * Tier-2's `pendingSideEffect.execute`) resolves to that exact same
 * value/reference, not a copy and not a mutation. See
 * test/flowV2Dispatcher.test.js — "async conversion — multi-message/
 * nested-function return shapes are unaffected by awaiting a still-
 * synchronous handler" — for a regression test proving this holds for
 * the two shapes in this codebase least obviously safe by inspection
 * alone: b2CoreForkExit.js's 4-message F2 exit sequence (array +
 * nested interactive.buttons array) and r7Tier2Handler.js's
 * `pendingSideEffect` (a nested, still-callable function reference).
 *
 * @param {object} ctx - see ctx shape above
 * @param {string} inboundMessage
 * @param {{ messageType?: string }} [meta]
 * @returns {Promise<object>} standard Flow v2 return shape
 */
async function processFlowV2Turn(ctx, inboundMessage, meta = {}) {
  const text = String(inboundMessage || '');
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const stage = ctx?.flowV2?.stage || null;

  // Crisis lock: checked before EVERYTHING else, including Node 0. Once
  // true, this conversation never resumes via Flow v2 bot logic again.
  if (profile.crisisLocked === true) {
    return crisisLockedReply();
  }

  // Node 0 is a pre-empt, not a stage: checked next, on every turn,
  // regardless of context.flowV2.stage — EXCEPT once the student is
  // already inside B7 · Book (Phase 7). Node 0's OVERRIDE_PATTERNS
  // includes bare `book` and `session` (so a student can jump straight to
  // booking from any EARLIER stage), which unavoidably overlaps with B7's
  // own primary button title, "Book my session" — without this exemption,
  // tapping B7's own button would be hijacked by Node 0 and re-enter
  // Node 0's separate, earlier-stage booking flow instead of continuing
  // B7's. Node 0's reason to exist — jumping to booking from somewhere
  // else — is moot once the student is already in the booking beat itself.
  const isB7Stage = typeof stage === 'string' && stage.startsWith('b7_');
  if (!isB7Stage && detectOverrideIntent(text)) {
    return handleNode0Override(ctx, text);
  }

  const classification = classifyReply(text, profile, {
    stage,
    messageType: meta.messageType || 'text',
    pendingQualificationGuess: ctx?.flowV2?.pendingQualificationGuess || null,
  });
  const { bucket } = classification;

  // R7 Tier-2 — hard stop, checked before any other bucket dispatch.
  if (bucket === 'R7' && classification.tier === 2) {
    return handleR7Tier2(ctx, text);
  }

  // R7 Tier-1 — one empathetic line, THEN falls through to whatever the
  // current stage was. Never reachable from/into the Tier-2 path above.
  if (bucket === 'R7' && classification.tier === 1) {
    const fallthrough = await runStageFallthrough(ctx, stage, text);
    const combinedReplyParts = [
      getR7Tier1PrefixLine(),
      ...(fallthrough.replyText ? [fallthrough.replyText] : []),
      ...(fallthrough.replyParts || []),
    ];
    return withDoorHistory(
      { ...fallthrough, replyText: null, replyParts: combinedReplyParts },
      ctx,
      bucket,
      stage
    );
  }

  // 8 fully self-contained, fully-wired buckets — intercept, do not fall
  // through to stage-based routing.
  if (WIRED_HANDLERS[bucket]) {
    const result = WIRED_HANDLERS[bucket](ctx, text, classification);
    return withDoorHistory(result, ctx, bucket, stage);
  }

  // R1-R4 (taps / types / over-answers / jumps ahead): destinations don't
  // exist yet (B1-B7 not built) — classify + record only, then fall
  // through to whatever stage handler already exists, UNCHANGED.
  const fallthrough = await runStageFallthrough(ctx, stage, text);
  return withDoorHistory(fallthrough, ctx, bucket, stage);
}

module.exports = {
  processFlowV2Turn,
};
