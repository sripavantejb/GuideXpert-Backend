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
 * ROUTING ORDER (Master Flow Stage 1): persisted crisis-lock short-circuit >
 * I-10 distress pre-check > Node 0 pre-empt > classifyReply() >
 * 8 fully-wired bucket handlers (R5,
 * R6, R7 both tiers, R8, R9, R10, R11, R12) > R1-R4 fallthrough
 * (stage-based routing, now covering B1/B2/the core-fork and its exit
 * sub-flow as of Phase 4, B3 as of Phase 5, B5/B6 as of Phase 6, and B7 as
 * of Phase 7 — the full B1-B7 beat spine is now wired end to end) >
 * safeFallbackReply.
 */

const { detectOverrideIntent, handleNode0Override, handleNode0SlotReply, handleNode0BackfillReply } = require('./nodes/node0Override');
const { handleGreetingEntry, handleGreetingReply, handleEntrySideTrackReply } = require('./nodes/greeting');
const { handleB2GoalEntry, handleB2GoalReply } = require('./nodes/b2Goal');
const { handleB1Entry, handleB1Reply } = require('./nodes/b1Goal');
const { handleB2Reply } = require('./nodes/b2Branch');
const { handleCoreForkReply } = require('./nodes/b2CoreFork');
const { handleCoreForkExitReply } = require('./nodes/b2CoreForkExit');
const { handleB3Entry, handleB3Reply } = require('./nodes/b3Constraints');
const { handleB5ChecklistEntry } = require('./nodes/b5Checklist');
const { handleB6PermissionEntry, handleB6PermissionReply } = require('./nodes/b6Permission');
const { handleB7TwoModelsEntry } = require('./nodes/b7TwoModels');
const { handleB8Entry, handleB8Reply, handleB8ShortlistAskEntry, handleB8ShortlistAskReply } = require('./nodes/b8FlatShortlist');
const { handleB9Entry, handleB9Reply } = require('./nodes/b9Fit');
const { handleB5Entry, handleB5Reply } = require('./nodes/b5Shortlist');
const { handleB6Entry } = require('./nodes/b6TheCase');
const { handleB7Entry, handleB7Reply } = require('./nodes/b7Book');
const { handleR4PEntry, handleR4PReply } = require('./nodes/r4pPredictor');
const { classifyReply } = require('./router/classifyReply');
const { isTier2Crisis } = require('./router/crisisClassifier');
const { extractFlowV2Slots } = require('./flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('./flowV2ProfileMerge');
const { combineNodeResults, withMergedProfile } = require('./flowV2NodeUtils');
const {
  detectNonDistressInterrupt,
  startNonDistressInterrupt,
  handlePendingInterrupt,
} = require('./nonDistressInterrupts');
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
const { handleR4, handleR4PendingReply } = require('./router/handlers/r4Handler');

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

/**
 * Master Flow beats must never end on a silent/ack-only `*_awaiting_entry`
 * park. Those stages were historically "wait for the next inbound" bridges
 * while later beats were unbuilt; once B3–B7 exist, parking leaves WhatsApp
 * looking stuck ("Solid — ..." then nothing). Drain them in the SAME turn.
 */
const AWAITING_ENTRY_HANDLERS = Object.freeze({
  greeting_captured_pending_b1: (ctx) => handleB2GoalEntry(ctx),
  b2_awaiting_entry: (ctx) => handleB2GoalEntry(ctx),
  b4_awaiting_entry: (ctx) => handleB1Entry(ctx),
  b5_checklist_awaiting_entry: (ctx) => handleB5ChecklistEntry(ctx),
  b6_permission_awaiting_entry: (ctx) => handleB6PermissionEntry(ctx),
  // V3 B6.5 constraints (also accept legacy b3_awaiting_entry park name).
  b65_awaiting_entry: (ctx) => handleB3Entry(ctx),
  b3_awaiting_entry: (ctx) => handleB3Entry(ctx),
  b7_two_models_awaiting_entry: (ctx) => handleB7TwoModelsEntry(ctx),
  b8_shortlist_ask_awaiting_entry: (ctx) => handleB8ShortlistAskEntry(ctx),
  b8_awaiting_entry: (ctx) => handleB8Entry(ctx),
  b9_awaiting_entry: (ctx) => handleB9Entry(ctx),
  b10_awaiting_entry: (ctx) => handleB7Entry(ctx),
  // Legacy aliases — still drain, but handlers now delegate to V3 B8/B9/B10.
  b5_awaiting_entry: (ctx) => handleB5Entry(ctx),
  b6_awaiting_entry: (ctx) => handleB6Entry(ctx),
  b7_awaiting_entry: (ctx) => handleB7Entry(ctx),
});

async function drainAwaitingEntryStages(ctx, result) {
  let current = result;
  for (let i = 0; i < 12; i += 1) {
    const stage = current?.contextPatch?.stage;
    const handler = stage ? AWAITING_ENTRY_HANDLERS[stage] : null;
    if (!handler) break;

    const nextCtx = {
      ...(ctx || {}),
      flowV2: {
        ...((ctx && ctx.flowV2) || {}),
        ...(current.contextPatch || {}),
        profile: current.contextPatch?.profile || ctx?.flowV2?.profile,
        stage,
      },
    };
    const entryResult = await handler(nextCtx);
    if (!entryResult || entryResult.contextPatch?.stage === stage) break;

    const prefixes = [
      ...(current.replyText ? [current.replyText] : []),
      ...(current.replyParts || []),
    ];
    const combined = prefixes.length ? combineNodeResults(prefixes, entryResult) : entryResult;
    if (current.pendingSideEffect && !combined.pendingSideEffect) {
      combined.pendingSideEffect = current.pendingSideEffect;
    }
    current = {
      ...combined,
      contextPatch: {
        ...(current.contextPatch || {}),
        ...(combined.contextPatch || {}),
      },
    };
  }
  return current;
}

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
  if (stage === 'node0_awaiting_slot') {
    return await handleNode0SlotReply(ctx, text);
  }
  if (stage === 'node0_awaiting_backfill') {
    // Backfill is optional. "Done" bypasses it and enters B7's existing
    // completion path; every other answer is offered to the backfill
    // handler, which either captures goalPriority or skips cleanly.
    if (/\bdone\b/i.test(String(text || ''))) {
      const doneCtx = { ...ctx, flowV2: { ...(ctx.flowV2 || {}), stage: 'b7_awaiting_done' } };
      return await handleB7Reply(doneCtx, text);
    }
    return await handleNode0BackfillReply(ctx, text);
  }
  if (
    stage === 'greeting_awaiting_name' ||
    stage === 'greeting_awaiting_qualification' ||
    stage === 'greeting_awaiting_reply'
  ) {
    return await handleGreetingReply(ctx, text);
  }
  if (typeof stage === 'string' && stage.startsWith('entry_')) {
    return await handleEntrySideTrackReply(ctx, text);
  }
  // V3 spine — B2 GOAL → B3 INTEREST (b2_*) → B3.2 core → B4 PRIORITY (b1_/b4_) →
  // B5 checklist → B6 permission → B7 two models (B6.5 skipped on company happy path;
  // legacy b3_*/b65_* still drained if parked) → B8 medal shortlist → B9 FIT →
  // B10 book (b7_* / b10_*).
  if (stage === 'greeting_captured_pending_b1') return await handleB2GoalEntry(ctx);
  if (stage === 'b2_awaiting_entry') return await handleB2GoalEntry(ctx);
  if (stage === 'b2_goal_awaiting_reply') return await handleB2GoalReply(ctx, text);
  if (stage === 'b1_awaiting_reply' || stage === 'b4_awaiting_reply') return await handleB1Reply(ctx, text);
  if (stage === 'b4_awaiting_entry') return await handleB1Entry(ctx);
  if (stage === 'b2_awaiting_reply') return await handleB2Reply(ctx, text);
  if (stage === 'b2_core_fork_awaiting_reply') return await handleCoreForkReply(ctx, text);
  if (stage === 'b2_core_exit_awaiting_reply') return await handleCoreForkExitReply(ctx, text);
  if (stage === 'b5_checklist_awaiting_entry') return await handleB5ChecklistEntry(ctx);
  if (stage === 'b6_permission_awaiting_reply') return await handleB6PermissionReply(ctx, text);
  if (stage === 'b6_permission_declined') return await handleB6PermissionReply(ctx, text);
  // B6.5 constraints
  if (stage === 'b65_awaiting_entry' || stage === 'b3_awaiting_entry') return await handleB3Entry(ctx);
  if (stage === 'b3_awaiting_budget') return await handleB3Reply(ctx, text);
  if (stage === 'b3_awaiting_location') return await handleB3Reply(ctx, text);
  if (stage === 'b3_awaiting_city') return await handleB3Reply(ctx, text);
  // B7 two models / B8 / B9
  if (stage === 'b7_two_models_awaiting_entry') return await handleB7TwoModelsEntry(ctx);
  if (stage === 'b8_shortlist_ask_awaiting_entry') return await handleB8ShortlistAskEntry(ctx);
  if (stage === 'b8_shortlist_ask_awaiting_reply' || stage === 'b8_shortlist_ask_declined') {
    return await handleB8ShortlistAskReply(ctx, text);
  }
  if (stage === 'b8_awaiting_entry') return await handleB8Entry(ctx);
  if (stage === 'b8_awaiting_reply') return await handleB8Reply(ctx, text);
  if (stage === 'b9_awaiting_entry') return await handleB9Entry(ctx);
  if (
    stage === 'b9_awaiting_reply' ||
    stage === 'b9_parked_warm' ||
    stage === 'b9_niat_interest_awaiting_reply'
  ) {
    return await handleB9Reply(ctx, text);
  }
  if (stage === 'b10_awaiting_entry') return await handleB7Entry(ctx);
  // Legacy stage names (handlers delegate to V3)
  if (stage === 'b5_awaiting_entry') return await handleB5Entry(ctx);
  if (stage === 'b5_awaiting_reply') return await handleB5Reply(ctx, text);
  if (stage === 'b5_change_awaiting_slot') return await handleB5Reply(ctx, text);
  if (stage === 'b5_change_awaiting_value') return await handleB5Reply(ctx, text);
  if (stage === 'b6_awaiting_entry') return await handleB6Entry(ctx);
  if (stage === 'b7_awaiting_entry') return await handleB7Entry(ctx);
  if (stage === 'b7_awaiting_reply') return await handleB7Reply(ctx, text);
  if (stage === 'b7_awaiting_slot') return await handleB7Reply(ctx, text);
  if (stage === 'b7_awaiting_done') return await handleB7Reply(ctx, text);
  if (stage === 'b7_post_decline') return await handleB7Reply(ctx, text);
  if (stage === 'b7_post_booking') return await handleB7Reply(ctx, text);
  // Stage 6 — R4 pending sub-stages and R4-P predictor stages.
  if (
    stage === 'r4_college_awaiting_reply' ||
    stage === 'r4_money_awaiting_reply' ||
    stage === 'r4_admission_awaiting_reply' ||
    stage === 'r4_vs_awaiting_reply'
  ) {
    const pending = await handleR4PendingReply(ctx, text);
    if (pending) return pending;
  }
  if (typeof stage === 'string' && stage.startsWith('r4p_')) {
    return await handleR4PReply(ctx, text);
  }
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
  const result = await processFlowV2TurnRaw(ctx, inboundMessage, meta);
  return drainAwaitingEntryStages(ctx, result);
}

/**
 * Inner turn router. Prefer `processFlowV2Turn` — it drains `*_awaiting_entry`
 * parks so the student always receives the next real question in-turn.
 */
async function processFlowV2TurnRaw(ctx, inboundMessage, meta = {}) {
  const text = String(inboundMessage || '');
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const stage = ctx?.flowV2?.stage || null;

  // Crisis lock: checked before EVERYTHING else, including Node 0. Once
  // true, this conversation never resumes via Flow v2 bot logic again.
  if (profile.crisisLocked === true) {
    return crisisLockedReply();
  }

  // I-10 genuine distress is a PIPELINE PRE-CHECK, not an ordinary
  // router branch. It must run before Node 0, slot extraction, and
  // classifyReply — a message such as "book a session, my life is over"
  // is a crisis escalation, never a booking conversion. classifyReply
  // retains the same check as defense in depth for direct callers, but
  // every real Flow v2 turn reaches this check first.
  if (isTier2Crisis(text)) {
    return handleR7Tier2(ctx, text);
  }

  // Part 13 Layer 3: extraction runs once at the turn boundary for every
  // non-crisis inbound message, before Node 0, classification, or stage
  // routing. Every downstream path sees the same additive merged profile;
  // no handler can accidentally discard facts merely because the message
  // took an override or leaf-router path.
  // A name answer is identity text, not a qualification turn. Keeping it
  // out of the generic slot extractor prevents names such as "Arts" or
  // "Degree" from silently contaminating the profile before Node E has
  // accepted (or rejected) them as a name.
  const extractedPatch = stage === 'greeting_awaiting_name' ? {} : extractFlowV2Slots(text, profile);
  if (!stage && !profile.rawFirstMessage && text) extractedPatch.rawFirstMessage = text;
  if (!profile.botState) extractedPatch.botState = 'career_counselling_flow_v2';
  const extractedProfile = mergeFlowV2Profile(profile, extractedPatch);
  const turnCtx = {
    ...(ctx || {}),
    flowV2: {
      ...((ctx && ctx.flowV2) || {}),
      profile: extractedProfile,
    },
  };

  // I-7 ("how much does this cost") must beat Node 0: bare `session` is an
  // OVERRIDE_PATTERN, and a price question containing that word must never
  // be mistaken for a booking jump. Answer the fee plainly first.
  {
    const earlyInterrupt = detectNonDistressInterrupt(text, stage);
    if (earlyInterrupt === 'I-7') {
      return startNonDistressInterrupt(turnCtx, 'I-7');
    }
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
  //
  // Also exempt `node0_awaiting_slot`: the hybrid slot list owns the next
  // reply (slot row / other time / free-text preference → website URL).
  const isB7Stage = typeof stage === 'string' && stage.startsWith('b7_');
  if (stage === 'node0_awaiting_slot') {
    return await handleNode0SlotReply(turnCtx, text);
  }
  if (!isB7Stage && detectOverrideIntent(text)) {
    // The link was already sent on the immediately preceding Node 0 turn.
    // A repeated booking word here is not a reason to send a duplicate
    // URL; treat it as skipping the optional backfill and continue into
    // the existing awaiting-Done helper path.
    if (stage === 'node0_awaiting_backfill' && extractedProfile.bookingStatus === 'link_sent') {
      return handleNode0BackfillReply(turnCtx, text);
    }
    return await handleNode0Override(turnCtx, text);
  }

  // Node E and its qualification side tracks are deterministic local
  // state machines. Route them before the generic R-bucket classifier so
  // row titles such as "Medical" and "Other" cannot be stolen by R11/R10.
  const isEntryStage =
    stage === 'greeting_awaiting_name' ||
    stage === 'greeting_awaiting_qualification' ||
    stage === 'greeting_awaiting_reply' ||
    (typeof stage === 'string' && stage.startsWith('entry_'));
  if (isEntryStage) {
    const isQualificationStage =
      stage === 'greeting_awaiting_qualification' || stage === 'greeting_awaiting_reply';
    if (isQualificationStage) {
      // A pending R10 confirmation/clarification is a deterministic Node E
      // state, so resolve it before attempting a fresh classification.
      if (
        turnCtx.flowV2.pendingQualificationGuess ||
        turnCtx.flowV2.pendingAmbiguousResolution
      ) {
        return await handleGreetingReply(turnCtx, text);
      }

      // Stage 5 reconciliation: Node E still owns qualification routing,
      // but its inbound is classified so typed rows (R2), multi-fact
      // answers (R3), and ambiguous answers (R10) receive their documented
      // behavior without moving Node E below ordinary interrupts.
      const entryClassification = classifyReply(text, extractedProfile, {
        stage,
        messageType: meta.messageType || 'text',
        pendingQualificationGuess: null,
      });
      if (entryClassification.bucket === 'R10') {
        return withDoorHistory(
          handleR10(turnCtx, text, entryClassification),
          turnCtx,
          entryClassification.bucket,
          stage
        );
      }
      return withDoorHistory(
        handleGreetingReply(turnCtx, text, {
          classification: entryClassification,
          messageType: meta.messageType || 'text',
        }),
        turnCtx,
        entryClassification.bucket,
        stage
      );
    }
    return await runStageFallthrough(turnCtx, stage, text);
  }

  // Stage 4b non-distress interrupts. Node E remains untouched above; for
  // the B1-B7 spine these run after I-10 and Node 0, but before the ordinary
  // reply classifier/stage logic. Pending interrupts always retain the
  // exact stage they interrupted instead of resetting the journey.
  if (stage === 'interrupt_i1_awaiting_reply' || stage === 'interrupt_i2_awaiting_reply') {
    const interruptResult = handlePendingInterrupt(turnCtx, text);
    if (interruptResult && interruptResult.interruptResolved) {
      const resumedCtx = {
        ...turnCtx,
        flowV2: {
          ...(turnCtx.flowV2 || {}),
          stage: interruptResult.interruptedStage,
          profile: interruptResult.profile,
          interruptedStage: null,
        },
      };
      const resumed = await runStageFallthrough(resumedCtx, interruptResult.interruptedStage, interruptResult.resumeText);
      return {
        ...resumed,
        replyText: null,
        replyParts: [interruptResult.confirmation, ...(resumed.replyText ? [resumed.replyText] : []), ...(resumed.replyParts || [])],
        contextPatch: { ...resumed.contextPatch, interruptedStage: null },
      };
    }
    return interruptResult;
  }

  if (
    stage === 'interrupt_i3_awaiting_reply' ||
    stage === 'interrupt_i4_awaiting_reply' ||
    stage === 'interrupt_i6_awaiting_reply'
  ) {
    return handlePendingInterrupt(turnCtx, text);
  }

  // Core-fork / exit + late-spine button stages own their replies — R4/Node
  // classification must not steal postback IDs like flowv2_b9_niat_yes or
  // "Yes, I'm interested" away from the NIAT interest / shortlist gates.
  if (
    stage === 'b2_core_fork_awaiting_reply' ||
    stage === 'b2_core_exit_awaiting_reply' ||
    stage === 'b6_permission_awaiting_reply' ||
    stage === 'b8_shortlist_ask_awaiting_reply' ||
    stage === 'b8_shortlist_ask_declined' ||
    stage === 'b9_awaiting_reply' ||
    stage === 'b9_niat_interest_awaiting_reply' ||
    stage === 'b9_parked_warm'
  ) {
    return withDoorHistory(await runStageFallthrough(turnCtx, stage, text), turnCtx, 'R1', stage);
  }

  const interruptId = detectNonDistressInterrupt(text, stage);
  if (interruptId) return startNonDistressInterrupt(turnCtx, interruptId);

  const classification = classifyReply(text, extractedProfile, {
    stage,
    messageType: meta.messageType || 'text',
    pendingQualificationGuess: ctx?.flowV2?.pendingQualificationGuess || null,
  });
  const { bucket } = classification;

  // R7 Tier-2 — defensive fallback for a future/direct classifier path.
  // The normal dispatcher path was already intercepted by the I-10
  // pipeline pre-check above before Node 0.
  if (bucket === 'R7' && classification.tier === 2) {
    return handleR7Tier2(turnCtx, text);
  }

  // R7 Tier-1 — one empathetic line, THEN falls through to whatever the
  // current stage was. Never reachable from/into the Tier-2 path above.
  if (bucket === 'R7' && classification.tier === 1) {
    const fallthrough = await runStageFallthrough(turnCtx, stage, text);
    const combinedReplyParts = [
      getR7Tier1PrefixLine(),
      ...(fallthrough.replyText ? [fallthrough.replyText] : []),
      ...(fallthrough.replyParts || []),
    ];
    return withDoorHistory(
      { ...fallthrough, replyText: null, replyParts: combinedReplyParts },
      turnCtx,
      bucket,
      stage
    );
  }

  // 8 fully self-contained, fully-wired buckets — intercept, do not fall
  // through to stage-based routing.
  if (WIRED_HANDLERS[bucket]) {
    const result = WIRED_HANDLERS[bucket](turnCtx, text, classification);
    return withDoorHistory(result, turnCtx, bucket, stage);
  }

  // R4 — jumps ahead: answer the need, then rejoin (R4-A → R4-P).
  if (bucket === 'R4') {
    const result = await handleR4(turnCtx, text, classification);
    return withDoorHistory(result, turnCtx, bucket, stage);
  }

  // R1-R3 (taps / types / over-answers): fall through to stage handlers.
  let fallthrough = await runStageFallthrough(turnCtx, stage, text);
  if (
    stage === 'b1_awaiting_reply' &&
    turnCtx.flowV2.r3OverAnswerPending === true &&
    fallthrough.contextPatch?.stage === 'b3_awaiting_entry'
  ) {
    const prefix = [
      ...(fallthrough.replyText ? [fallthrough.replyText] : []),
      ...(fallthrough.replyParts || []),
    ];
    const skippedB3 = handleB3Entry(
      withMergedProfile(turnCtx, fallthrough.contextPatch.profile)
    );
    fallthrough = combineNodeResults(prefix, skippedB3);
    fallthrough.contextPatch = {
      ...fallthrough.contextPatch,
      r3OverAnswerPending: null,
    };
  }
  return withDoorHistory(fallthrough, turnCtx, bucket, stage);
}

module.exports = {
  processFlowV2Turn,
  // exported for focused unit tests of the drain contract
  drainAwaitingEntryStages,
};
