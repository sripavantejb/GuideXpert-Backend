'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { handleB1Entry, handleB1Reply, B1_QUESTION_TAIL, B1_ROWS } = require('../services/chatbot/flowV2/nodes/b1Goal');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');

function ctxWithProfile(patch = {}) {
  return { flowV2: { profile: { ...emptyFlowV2Profile(), ...patch } } };
}

function isChecklistOrPermissionStage(stage) {
  return (
    stage === 'b5_checklist_awaiting_entry' ||
    stage === 'b5_awaiting_reply' ||
    stage === 'b6_permission_awaiting_reply' ||
    stage === 'b6_permission_declined' ||
    stage === 'b3_awaiting_entry'
  );
}

describe('b1Goal — handleB1Entry (V3 B4 PRIORITY)', () => {
  test('asks the B4 priority question (list with 7 company rows) and sets stage when goalPriority is empty', () => {
    const result = handleB1Entry(ctxWithProfile({ qualification: 'Class 12 (MPC)' }));
    assert.equal(result.interactive.type, 'list');
    assert.equal(result.interactive.sections[0].rows.length, 7);
    assert.equal(B1_ROWS.length, 7);
    assert.match(result.interactive.body, /One more thing/i);
    assert.equal(result.contextPatch.stage, 'b4_awaiting_reply');
  });

  test('REGRESSION (Phase 4 propagation bug): the "ask B1 question" branch still carries forward a profile mutated by an upstream caller, not just an unmutated pass-through', () => {
    // Simulates the exact chain shape the original bug affected: this
    // function is reached with a profile some earlier step already
    // patched (here, a qualification the caller just merged in) — if the
    // "ask question" branch ever drops `profile` from its contextPatch
    // again, that upstream mutation would silently vanish.
    const mutatedProfile = { ...emptyFlowV2Profile(), qualification: 'Class 12 (MPC)', rank: 18453 };
    const result = handleB1Entry({ flowV2: { profile: mutatedProfile } });
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    assert.equal(result.contextPatch.profile.rank, 18453);
  });

  test('SKIP: an R3-classified message that already filled goalPriority never sees the B4 question', () => {
    const result = handleB1Entry(ctxWithProfile({ goalPriority: ['placement'] }));
    // Must have skipped straight into checklist / permission — never the B4 list.
    assert.notEqual(result.contextPatch.stage, 'b4_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b1_awaiting_reply');
    assert.ok(!(result.interactive?.body || '').includes(B1_QUESTION_TAIL));
    const rowTitles = (result.interactive?.sections?.[0]?.rows || []).map((r) => r.title);
    assert.ok(!rowTitles.includes('Placements'));
  });

  test('the skip lands on the checklist / permission path (V3: not B2 branch)', () => {
    const result = handleB1Entry(ctxWithProfile({ goalPriority: ['placement'] }));
    assert.ok(
      isChecklistOrPermissionStage(result.contextPatch.stage),
      `expected checklist/permission stage, got ${result.contextPatch.stage}`
    );
  });
});

describe('b1Goal — handleB1Reply (V3 B4 PRIORITY)', () => {
  test('a confident goalPriority extraction acks and advances (combined reply, not a bare re-ask)', () => {
    const result = handleB1Reply(ctxWithProfile({ qualification: 'Class 12 (MPC)' }), 'Strong placements');
    assert.ok(result.contextPatch.profile.goalPriority.includes('placement') || result.contextPatch.profile.goalPriority.includes('placements'));
    assert.ok((result.replyParts || []).some((p) => /Noted/i.test(p)));
    assert.notEqual(result.contextPatch.stage, 'b4_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b1_awaiting_reply');
  });

  test('"Not sure yet" does NOT set a default goalPriority value and re-asks (never silently defaults)', () => {
    const result = handleB1Reply(ctxWithProfile({ qualification: 'Class 12 (MPC)' }), 'Not sure yet');
    assert.deepEqual(result.contextPatch.profile.goalPriority, []);
    assert.equal(result.contextPatch.stage, 'b4_awaiting_reply');
    assert.equal(result.interactive.type, 'list');
  });

  test('an R4-rank message ("my rank is 18453") does not set a default goalPriority, but silently keeps the rank for later', () => {
    const result = handleB1Reply(ctxWithProfile({ qualification: 'Class 12 (MPC)' }), 'my rank is 18453');
    assert.deepEqual(result.contextPatch.profile.goalPriority, []);
    assert.equal(result.contextPatch.profile.rank, 18453);
    assert.equal(result.contextPatch.stage, 'b4_awaiting_reply');
  });

  test('re-ask never regresses previously-filled unrelated fields (additive merge)', () => {
    const result = handleB1Reply(ctxWithProfile({ qualification: 'Class 12 (MPC)', cityPref: 'Hyderabad' }), 'not sure yet');
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
  });

  test('an over-answering B4 reply that ALSO contains a non-core branch advances to checklist/permission (V3)', () => {
    const result = handleB1Reply(
      ctxWithProfile({ qualification: 'Class 12 (MPC)' }),
      'placements matter most, want cse, budget 3 lakhs, hyderabad only'
    );
    assert.equal(result.contextPatch.profile.branchInterest, 'CSE');
    assert.ok(
      isChecklistOrPermissionStage(result.contextPatch.stage),
      `expected checklist/permission stage, got ${result.contextPatch.stage}`
    );
  });

  test('an over-answering B4 reply with a CORE branch still advances to checklist/permission (fork is B3 interest path)', () => {
    const result = handleB1Reply(ctxWithProfile({ qualification: 'Class 12 (MPC)' }), 'placements matter, i want mechanical');
    assert.ok(
      isChecklistOrPermissionStage(result.contextPatch.stage),
      `expected checklist/permission stage, got ${result.contextPatch.stage}`
    );
    assert.notEqual(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
  });
});

describe('b1Goal — full dispatcher regression (R1-R4 fallthrough still lands correctly)', () => {
  test('a plain list tap ("AI & future tech") from stage=b1_awaiting_reply is classified and answered, not misrouted', async () => {
    const ctx = { flowV2: { stage: 'b1_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'AI & future tech');
    assert.ok(result.contextPatch.profile.goalPriority.includes('ai_future_tech'));
  });
});
