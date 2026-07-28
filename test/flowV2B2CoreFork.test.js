'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleCoreForkEntry,
  handleCoreForkReply,
  handleCoreForkTellMeMore,
  extractCoreField,
  OFFER_MESSAGE_1,
  OFFER_MESSAGE_2,
  OFFER_MESSAGE_3,
  OFFER_MESSAGE_4,
  PARENT_VARIANT_TEXT,
  TELL_ME_MORE_BUBBLES,
  F1_ACK_TEXT,
} = require('../services/chatbot/flowV2/nodes/b2CoreFork');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');

function ctxWithProfile(patch = {}) {
  return { flowV2: { profile: { ...emptyFlowV2Profile(), ...patch } } };
}

describe('b2CoreFork — extractCoreField', () => {
  test('recognizes mechanical, civil, ece, eee explicitly', () => {
    assert.equal(extractCoreField('I want mechanical'), 'mechanical');
    assert.equal(extractCoreField('civil interests me'), 'civil');
    assert.equal(extractCoreField('thinking ECE'), 'ece');
    assert.equal(extractCoreField('EEE maybe'), 'ece');
  });

  test('defaults to mechanical for a generic/unspecified message', () => {
    assert.equal(extractCoreField('Core engineering (mech, civil, ECE)'), 'mechanical');
    assert.equal(extractCoreField(''), 'mechanical');
  });
});

describe('b2CoreFork — handleCoreForkEntry (student variant)', () => {
  test('sends the three-message offer sequence verbatim, plus the 4th message + 3 buttons', () => {
    const result = handleCoreForkEntry(ctxWithProfile(), 'I want mechanical');
    assert.deepEqual(result.replyParts, [OFFER_MESSAGE_1, OFFER_MESSAGE_2, OFFER_MESSAGE_3]);
    assert.equal(result.interactive.body, OFFER_MESSAGE_4);
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), [
      'Yes, show me',
      'I want pure mechanical',
      'Tell me more first',
    ]);
  });

  test('sets coreInterest, coreBridgeAttempted=true, and the fork stage', () => {
    const result = handleCoreForkEntry(ctxWithProfile(), 'civil please');
    assert.equal(result.contextPatch.profile.coreInterest, 'civil');
    assert.equal(result.contextPatch.profile.coreBridgeAttempted, true);
    assert.equal(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
  });
});

describe('b2CoreFork — handleCoreForkEntry (parent variant)', () => {
  test('isParent=true sends the ROI line, NOT the joke, but the same 3 buttons', () => {
    const result = handleCoreForkEntry(ctxWithProfile({ isParent: true }), 'mechanical');
    assert.equal(result.replyParts, null);
    assert.equal(result.interactive.body, PARENT_VARIANT_TEXT);
    assert.ok(!result.interactive.body.includes('running joke'));
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), [
      'Yes, show me',
      'I want pure mechanical',
      'Tell me more first',
    ]);
  });
});

describe('b2CoreFork — coreBridgeAttempted guard rail', () => {
  test('calling handleCoreForkEntry twice in a row never re-sends the pitch the second time', () => {
    const first = handleCoreForkEntry(ctxWithProfile(), 'mechanical');
    assert.ok(first.replyParts && first.replyParts.length > 0);

    const secondCtx = ctxWithProfile({ ...first.contextPatch.profile });
    const second = handleCoreForkEntry(secondCtx, 'mechanical');
    assert.equal(second.replyParts, null);
    assert.equal(second.interactive, null);
    assert.deepEqual(second.contextPatch, {});
  });

  test('the parent variant is ALSO blocked by coreBridgeAttempted (checked before ANY message, including the parent variant)', () => {
    const result = handleCoreForkEntry(ctxWithProfile({ isParent: true, coreBridgeAttempted: true }), 'mechanical');
    assert.equal(result.replyParts, null);
    assert.equal(result.interactive, null);
  });
});

describe('b2CoreFork — handleCoreForkReply (F1)', () => {
  test('"Yes, show me" keeps coreInterest, overwrites branchInterest to cse_ai, acks, advances to B4 priority', () => {
    const ctx = ctxWithProfile({ coreInterest: 'mechanical', coreBridgeAttempted: true, branchInterest: 'Mechanical' });
    const result = handleCoreForkReply(ctx, 'Yes, show me');
    assert.equal(result.contextPatch.profile.branchInterest, 'cse_ai');
    assert.equal(result.contextPatch.profile.coreInterest, 'mechanical');
    assert.equal(result.replyText, F1_ACK_TEXT);
    assert.equal(result.contextPatch.stage, 'b4_awaiting_entry');
    assert.notEqual(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
  });
});

describe('b2CoreFork — handleCoreForkReply (F3 — "tell me more")', () => {
  test('sends field-specific copy and loops back to the same three buttons without re-triggering the pitch', () => {
    const ctx = ctxWithProfile({ coreInterest: 'civil', coreBridgeAttempted: true, branchInterest: 'Civil' });
    const result = handleCoreForkReply(ctx, 'Tell me more first');
    assert.deepEqual(result.replyParts, [TELL_ME_MORE_BUBBLES.civil]);
    assert.equal(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), [
      'Yes, show me',
      'I want pure mechanical',
      'Tell me more first',
    ]);
    // Original 3-message pitch must not be re-sent — only 1 bubble this time.
    assert.equal(result.replyParts.length, 1);
  });

  test('handleCoreForkTellMeMore is directly callable and picks the ece bubble (also used for eee)', () => {
    const ctx = ctxWithProfile({ coreInterest: 'ece' });
    const result = handleCoreForkTellMeMore(ctx, 'tell me more');
    assert.deepEqual(result.replyParts, [TELL_ME_MORE_BUBBLES.ece]);
  });

  test('a student can loop through "tell me more" multiple times and still land on F1/F2 afterward', () => {
    const ctx = ctxWithProfile({ coreInterest: 'mechanical', coreBridgeAttempted: true, branchInterest: 'Mechanical' });
    const looped = handleCoreForkReply(ctx, 'Tell me more first');
    assert.equal(looped.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    const thenYes = handleCoreForkReply(ctx, 'Yes, show me');
    assert.equal(thenYes.contextPatch.profile.branchInterest, 'cse_ai');
  });
});

describe('b2CoreFork — F1 preserves coreInterest specifically (pre-Phase-5 data-flow check)', () => {
  test('coreInterest is byte-identical before and after F1, for every field value the fork can set it to', () => {
    for (const field of ['mechanical', 'civil', 'ece']) {
      const ctx = ctxWithProfile({ coreInterest: field, coreBridgeAttempted: true, branchInterest: 'core' });
      const result = handleCoreForkReply(ctx, 'Yes, show me');
      assert.equal(result.contextPatch.profile.coreInterest, field, `coreInterest lost for field=${field}`);
      assert.equal(result.contextPatch.profile.branchInterest, 'cse_ai');
    }
  });

  test('end-to-end through the FULL dispatcher (fork entry turn, then a separate F1 turn) — not just a direct handler call', async () => {
    // Turn 1: a real inbound message resolves branch = core engineering,
    // firing the fork for real (coreInterest is set by extraction here,
    // not hand-populated by the test).
    let ctx = { flowV2: { stage: 'b2_awaiting_reply', profile: emptyFlowV2Profile() } };
    const entryResult = await processFlowV2Turn(ctx, 'I want mechanical');
    assert.equal(entryResult.contextPatch.profile.coreInterest, 'mechanical');

    // Turn 2: the student's actual next inbound message, using ONLY what
    // turn 1 persisted — exactly how a live conversation would replay this.
    ctx = { flowV2: { stage: entryResult.contextPatch.stage, profile: entryResult.contextPatch.profile } };
    const f1Result = await processFlowV2Turn(ctx, 'Yes, show me');

    assert.equal(f1Result.contextPatch.profile.coreInterest, 'mechanical');
    assert.equal(f1Result.contextPatch.profile.branchInterest, 'cse_ai');
    // V3: F1 drains into B4 priority (9-row list), not B3 constraints.
    assert.ok(
      f1Result.contextPatch.stage === 'b4_awaiting_reply' ||
        f1Result.contextPatch.stage === 'b4_awaiting_entry' ||
        f1Result.contextPatch.stage === 'b6_permission_awaiting_reply',
      `expected B4 priority (or drained checklist/permission), got ${f1Result.contextPatch.stage}`
    );
    if (f1Result.contextPatch.stage === 'b4_awaiting_reply') {
      assert.equal(f1Result.interactive.type, 'list');
      assert.equal(f1Result.interactive.sections[0].rows.length, 7);
    }
    // Full profile object, not a partial/truncated one — every schema
    // slot the entry turn had is still present after F1.
    assert.deepEqual(Object.keys(f1Result.contextPatch.profile).sort(), Object.keys(emptyFlowV2Profile()).sort());
  });
});

describe('b2CoreFork — handleCoreForkReply (F2 route-in)', () => {
  test('"I want pure mechanical" routes into the honest-exit sub-flow, does NOT advance to B4 directly', () => {
    const ctx = ctxWithProfile({ coreInterest: 'mechanical', coreBridgeAttempted: true, branchInterest: 'Mechanical' });
    const result = handleCoreForkReply(ctx, 'I want pure mechanical');
    assert.equal(result.contextPatch.stage, 'b2_core_exit_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b3_awaiting_entry');
  });
});

describe('b2CoreFork — handleCoreForkReply (unrecognized)', () => {
  test('an unrecognized reply re-offers the same three buttons, never silently defaults to one', () => {
    const ctx = ctxWithProfile({ coreInterest: 'mechanical', coreBridgeAttempted: true, branchInterest: 'Mechanical' });
    const result = handleCoreForkReply(ctx, 'asdkjaskd unrelated');
    assert.equal(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), [
      'Yes, show me',
      'I want pure mechanical',
      'Tell me more first',
    ]);
  });
});
