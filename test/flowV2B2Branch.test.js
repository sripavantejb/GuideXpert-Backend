'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleB2Entry,
  handleB2Reply,
  isCoreEngineeringBranch,
  isBusinessBranch,
  B2_ROWS,
  DONE_ROW,
  B2_LIST_SECTION_TITLE,
  buildInterestRows,
} = require('../services/chatbot/flowV2/nodes/b2Branch');
const { OUT_OF_SCOPE_TEXT } = require('../services/chatbot/flowV2/router/handlers/r11Handler');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');

function ctxWithProfile(patch = {}) {
  return { flowV2: { profile: { ...emptyFlowV2Profile(), ...patch } } };
}

describe('b2Branch — isCoreEngineeringBranch / isBusinessBranch', () => {
  test('mechanical/civil/ece/eee/core are all recognized as core engineering', () => {
    for (const v of ['Mechanical', 'Civil', 'ECE', 'EEE', 'core', 'MECHANICAL']) {
      assert.equal(isCoreEngineeringBranch(v), true, v);
    }
    assert.equal(isCoreEngineeringBranch('CSE'), false);
    assert.equal(isCoreEngineeringBranch(null), false);
  });

  test('Business/Commerce (and mba/bba) are recognized as the business branch', () => {
    assert.equal(isBusinessBranch('Business/Commerce'), true);
    assert.equal(isBusinessBranch('mba'), true);
    assert.equal(isBusinessBranch('CSE'), false);
  });
});

describe('b2Branch — WhatsApp list shape', () => {
  test('section title is short Interests (not instructional echo text)', () => {
    assert.equal(B2_LIST_SECTION_TITLE, 'Interests');
    assert.ok(B2_LIST_SECTION_TITLE.length <= 24);
  });

  test('every interest row title fits WhatsApp 24-char list limit', () => {
    for (const row of B2_ROWS) {
      assert.ok(row.title.length <= 24, `${row.title} is ${row.title.length} chars`);
    }
    assert.ok(DONE_ROW.title.length <= 24);
  });

  test('after first pick, list leads with Done and drops already-selected rows', () => {
    const rows = buildInterestRows(['computers_software']);
    assert.equal(rows[0].id, DONE_ROW.id);
    assert.ok(!rows.some((r) => /computers/i.test(r.title)));
    assert.ok(!rows.some((r) => /not sure/i.test(r.title)));
  });
});

describe('b2Branch — handleB2Entry', () => {
  test('asks the V3 interest list (9 company rows) when interests/branch empty', () => {
    const result = handleB2Entry(ctxWithProfile());
    assert.equal(result.interactive.type, 'list');
    assert.equal(result.interactive.sections[0].rows.length, 9);
    assert.equal(result.interactive.sections[0].title, 'Interests');
    assert.equal(B2_ROWS.length, 9);
    assert.equal(result.contextPatch.stage, 'b2_awaiting_reply');
    assert.match(result.interactive.body, /topics excite you/i);
    assert.ok(!result.interactive.sections[0].rows.some((r) => r.id === DONE_ROW.id));
    assert.ok(!result.interactive.sections[0].rows.some((r) => /core engineering/i.test(r.title)));
  });

  test('REGRESSION (Phase 4 propagation bug): the "ask B2 question" branch still carries forward a profile mutated by an upstream caller (B1\'s chain), not just an unmutated pass-through', () => {
    const mutatedProfile = { ...emptyFlowV2Profile(), qualification: 'Class 12 (MPC)', goalPriority: ['placement'] };
    const result = handleB2Entry({ flowV2: { profile: mutatedProfile } });
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    assert.deepEqual(result.contextPatch.profile.goalPriority, ['placement']);
  });

  test('SKIP to B4 priority works when branchInterest is pre-filled and non-core (e.g. CSE)', () => {
    const result = handleB2Entry(ctxWithProfile({ branchInterest: 'CSE' }));
    assert.equal(result.contextPatch.stage, 'b4_awaiting_entry');
    assert.equal(result.interactive, null);
  });

  test('SKIP to the core fork works when branchInterest is pre-filled AS core (R4-D "I want mechanical" must still trigger the full fork, not bypass it)', () => {
    const result = handleB2Entry(ctxWithProfile({ branchInterest: 'Mechanical' }));
    assert.equal(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.equal(result.contextPatch.profile.coreBridgeAttempted, true);
    assert.ok(result.replyParts && result.replyParts.length > 0);
  });

  test('SKIP: "Business" with a pre-filled branchInterest routes to R11, reusing its exact copy', () => {
    const result = handleB2Entry(ctxWithProfile({ branchInterest: 'Business/Commerce' }));
    assert.equal(result.interactive.body, OUT_OF_SCOPE_TEXT);
  });

  test('coreBridgeClosed makes it structurally impossible to re-enter the fork, even if branchInterest reads back as core', () => {
    const result = handleB2Entry(ctxWithProfile({ coreBridgeClosed: true, branchInterest: 'core' }));
    assert.notEqual(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.equal(result.contextPatch.stage, 'b4_awaiting_entry');
    assert.equal(result.replyParts, null);
    assert.equal(result.interactive, null);
  });
});

describe('b2Branch — handleB2Reply (V3 multi-select)', () => {
  test('first tap stays collecting and offers I\'m done; Done advances to B4', () => {
    const mid = handleB2Reply(ctxWithProfile(), 'Computers');
    assert.equal(mid.contextPatch.stage, 'b2_awaiting_reply');
    assert.ok(mid.contextPatch.profile.interests.includes('computers_software'));
    assert.match(mid.interactive.body, /Noted|done/i);
    assert.equal(mid.interactive.sections[0].rows[0].id, DONE_ROW.id);

    const result = handleB2Reply(
      { flowV2: { profile: mid.contextPatch.profile, stage: 'b2_awaiting_reply' } },
      "I'm done ✓"
    );
    assert.equal(result.contextPatch.profile.branchInterest, 'cse_ai');
    assert.equal(result.contextPatch.profile.interestCluster, 'software');
    assert.equal(result.contextPatch.stage, 'b4_awaiting_entry');
    assert.ok(result.replyText);
  });

  test('two picks then Done keeps both interests', () => {
    let mid = handleB2Reply(ctxWithProfile(), 'Computers');
    mid = handleB2Reply(
      { flowV2: { profile: mid.contextPatch.profile, stage: 'b2_awaiting_reply' } },
      'Artificial Intelligence'
    );
    assert.deepEqual(mid.contextPatch.profile.interests, [
      'computers_software',
      'artificial_intelligence',
    ]);
    const result = handleB2Reply(
      { flowV2: { profile: mid.contextPatch.profile, stage: 'b2_awaiting_reply' } },
      'flowv2_b3_done'
    );
    assert.equal(result.contextPatch.stage, 'b4_awaiting_entry');
    assert.equal(result.contextPatch.profile.interestCluster, 'data_ai');
  });

  test('fourth pick auto-advances without another loop', () => {
    let profile = emptyFlowV2Profile();
    for (const title of ['Computers', 'Data Science', 'Cloud Computing']) {
      const mid = handleB2Reply({ flowV2: { profile, stage: 'b2_awaiting_reply' } }, title);
      profile = mid.contextPatch.profile;
      assert.equal(mid.contextPatch.stage, 'b2_awaiting_reply');
    }
    const result = handleB2Reply(
      { flowV2: { profile, stage: 'b2_awaiting_reply' } },
      'Cyber Security'
    );
    assert.equal(result.contextPatch.stage, 'b4_awaiting_entry');
    assert.equal(result.contextPatch.profile.interests.length, 4);
  });

  test('legacy "Design / product" free-text still advances to B4', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Design / product');
    assert.equal(result.contextPatch.profile.branchInterest, 'design');
    assert.equal(result.contextPatch.stage, 'b4_awaiting_entry');
  });

  test('"Data Science" tap + done advances with data_ai cluster', () => {
    const mid = handleB2Reply(ctxWithProfile(), 'Data Science');
    assert.equal(mid.contextPatch.stage, 'b2_awaiting_reply');
    const result = handleB2Reply(
      { flowV2: { profile: mid.contextPatch.profile, stage: 'b2_awaiting_reply' } },
      'done'
    );
    assert.equal(result.contextPatch.profile.branchInterest, 'data_analytics');
    assert.equal(result.contextPatch.profile.interestCluster, 'data_ai');
    assert.equal(result.contextPatch.stage, 'b4_awaiting_entry');
  });

  test('"Core engineering" tap routes into the fork, does NOT advance to B4 directly', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Core engineering');
    assert.equal(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b4_awaiting_entry');
  });

  test('"Business / management" tap with no catalog routes to R11, reusing its existing handler (not duplicated copy)', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Business / management');
    assert.equal(result.interactive.body, OUT_OF_SCOPE_TEXT);
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), ['Book a session', 'Tell me about tech anyway']);
  });

  test('"Not sure yet" is a legitimate answer — sets undecided and advances (no loop)', () => {
    const result = handleB2Reply(ctxWithProfile(), 'Not sure yet');
    assert.equal(result.contextPatch.profile.branchInterest, null);
    assert.equal(result.contextPatch.profile.interestCluster, 'undecided');
    assert.equal(result.contextPatch.stage, 'b4_awaiting_entry');
  });
});

describe('b2Branch — full dispatcher regression', () => {
  test('an R4-rank message at stage=b2_awaiting_reply jumps to R4-P (answer the need first), keeping rank', async () => {
    const ctx = { flowV2: { stage: 'b2_awaiting_reply', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'my rank is 5000');
    assert.equal(result.contextPatch.profile.rank, 5000);
    assert.equal(result.contextPatch.profile.jumpType, 'rank');
    assert.ok(
      String(result.contextPatch.stage || '').startsWith('r4p_'),
      `expected r4p_* stage, got ${result.contextPatch.stage}`
    );
  });
});
