'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleB5Entry,
  handleB5Reply,
  mapFlowV2ProfileToMatrixProfile,
  mapCuratedCatalogToMatrixColleges,
  applyCuratedTieBreakBoost,
  computeTiers,
  buildShortlistBody,
  extractB5Action,
  extractChangeSlotChoice,
  B5_BUTTONS,
} = require('../services/chatbot/flowV2/nodes/b5Shortlist');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');

function ctxWithProfile(patch = {}, extra = {}) {
  return { flowV2: { profile: { ...emptyFlowV2Profile(), ...patch }, ...extra } };
}

const STANDARD_PROFILE_PATCH = {
  qualification: 'Class 12 (MPC)',
  goalPriority: ['placement'],
  branchInterest: 'cse_ai',
  budgetBand: '2_5l',
  cityPref: 'Hyderabad',
};

describe('b5Shortlist — mapFlowV2ProfileToMatrixProfile (adapter)', () => {
  test('maps goalPriority/branchInterest/budgetBand/cityPref onto old-V2 vocabulary', () => {
    const mapped = mapFlowV2ProfileToMatrixProfile({
      goalPriority: ['placement'],
      branchInterest: 'cse_ai',
      budgetBand: '2_5l',
      cityPref: 'Hyderabad',
    });
    assert.equal(mapped.preferredCourse, 'Computer Science / AI Engineering');
    assert.equal(mapped.careerGoal, 'placements');
    assert.equal(mapped.careerPriority, 'placements');
    assert.deepEqual(mapped.evaluationPriorities, ['placements']);
    assert.equal(mapped.budgetPreference, '5 lakhs');
    assert.equal(mapped.preferredLocation, 'Hyderabad');
    assert.equal(mapped.relocationPreference, null);
  });

  test('relocation stances (open_to_move/metro) map to relocationPreference, not a fake city name', () => {
    const mapped = mapFlowV2ProfileToMatrixProfile({ cityPref: 'open_to_move' });
    assert.equal(mapped.preferredLocation, null);
    assert.equal(mapped.relocationPreference, 'open');
  });

  test('goalPriority labels with no faithful old-V2 evaluationPriorities equivalent are honestly left unmapped', () => {
    const mapped = mapFlowV2ProfileToMatrixProfile({ goalPriority: ['ai_future_tech', 'startup'] });
    assert.deepEqual(mapped.evaluationPriorities, []);
    // still used for careerGoal/careerPriority though — not entirely dropped
    assert.equal(mapped.careerGoal, 'AI and future tech');
  });

  test('an empty/default profile does not throw and returns sane fallbacks', () => {
    const mapped = mapFlowV2ProfileToMatrixProfile({});
    assert.equal(mapped.preferredCourse, 'B.Tech / Engineering');
    assert.equal(mapped.careerGoal, null);
    assert.equal(mapped.budgetPreference, null);
  });
});

describe('b5Shortlist — mapCuratedCatalogToMatrixColleges (duplicated adapter)', () => {
  test('returns all 10 curated colleges with the same generic branch shape as the private original', () => {
    const colleges = mapCuratedCatalogToMatrixColleges();
    assert.equal(colleges.length, 10);
    for (const c of colleges) {
      assert.equal(c.college_address, '');
      assert.equal(c.branches.length, 1);
      assert.equal(c.branches[0].branch_name, 'Computer Science / Emerging Tech');
      assert.equal(c.branches[0].fee, null);
    }
    assert.ok(colleges.some((c) => /niat/i.test(c.college_name)));
  });
});

describe('b5Shortlist — applyCuratedTieBreakBoost (duplicated tie-break)', () => {
  test('gives NIAT an extra boost when the profile signal blob contains AI/project/industry language', () => {
    const niat = mapCuratedCatalogToMatrixColleges().find((c) => /niat/i.test(c.college_name));
    const boost = applyCuratedTieBreakBoost(niat, { goalPriority: ['ai_future_tech'], branchInterest: 'cse_ai' });
    assert.ok(boost > 0, `expected a positive boost, got ${boost}`);
  });

  test('gives no NIAT-specific boost when no AI/project/industry signal is present', () => {
    const niat = mapCuratedCatalogToMatrixColleges().find((c) => /niat/i.test(c.college_name));
    const boost = applyCuratedTieBreakBoost(niat, { goalPriority: ['affordable'], branchInterest: 'data_analytics' });
    // 'data_analytics' -> deslugged 'data analytics' does not itself trip
    // the NIAT AI/project/industry regex, and 'affordable' matches no tag.
    assert.equal(boost, 0);
  });

  test('never exceeds the 0.2 cap', () => {
    const niat = mapCuratedCatalogToMatrixColleges().find((c) => /niat/i.test(c.college_name));
    const boost = applyCuratedTieBreakBoost(niat, {
      goalPriority: ['placement', 'ai_future_tech', 'startup'],
      branchInterest: 'cse_ai',
      coreInterest: 'mechanical',
    });
    assert.ok(boost <= 0.2);
  });
});

describe('b5Shortlist — computeTiers (real reuse of scoreEligibleColleges/tierRecommendations)', () => {
  test('produces a tiered shortlist (best/strong/worth) for a standard profile', () => {
    const { tiers, confidence } = computeTiers({ ...emptyFlowV2Profile(), ...STANDARD_PROFILE_PATCH });
    assert.ok(tiers.bestMatch.length >= 1);
    assert.ok(tiers.strongAlternatives.length >= 1);
    assert.ok(typeof confidence === 'number' || typeof confidence === 'object');
  });
});

describe('b5Shortlist — handleB5Entry', () => {
  test('produces a 3-button interactive with a tiered shortlist body, and writes profile.shortlist', () => {
    const result = handleB5Entry(ctxWithProfile(STANDARD_PROFILE_PATCH));
    assert.equal(result.interactive.type, 'button');
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), ['Compare them', 'Just the best fit', 'Change something']);
    assert.ok(result.interactive.body.includes('*Best Match*'));
    assert.equal(result.contextPatch.stage, 'b5_awaiting_reply');
    assert.ok(Array.isArray(result.contextPatch.profile.shortlist));
    assert.ok(result.contextPatch.profile.shortlist.length > 0);
    assert.ok(result.contextPatch.profile.shortlist.every((c) => c.collegeName && c.tier && typeof c.matchScore === 'number'));
  });

  test('REGRESSION (Phase 4/5 propagation-bug shape): contextPatch always carries the profile forward', () => {
    const result = handleB5Entry(ctxWithProfile({ ...STANDARD_PROFILE_PATCH, qualification: 'Class 12 (MPC)' }));
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
  });
});

describe('b5Shortlist — coreInterest payoff (buildShortlistBody, deterministic fixtures)', () => {
  const bestMatchNiat = [
    { collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)', tier: 'best_match', matchScore: 0.9, why: 'AI-first curriculum.' },
    { collegeName: 'Plaksha University', tier: 'strong_alternative', matchScore: 0.7, why: 'Interdisciplinary tech education.' },
  ];
  const bestMatchOther = [
    { collegeName: 'Plaksha University', tier: 'best_match', matchScore: 0.9, why: 'Interdisciplinary tech education.' },
    { collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)', tier: 'strong_alternative', matchScore: 0.7, why: 'AI-first curriculum.' },
  ];

  test('mechanical: appends the mechanical-specific payoff line to NIAT\u2019s best-match line only', () => {
    const body = buildShortlistBody(bestMatchNiat, { goalPriority: [], coreInterest: 'mechanical' });
    assert.ok(body.includes('robotics and automation'));
    const niatLine = body.split('\n').find((l) => l.includes('NIAT'));
    assert.ok(niatLine.includes('robotics and automation'));
  });

  test('civil: appends the civil-specific payoff line', () => {
    const body = buildShortlistBody(bestMatchNiat, { goalPriority: [], coreInterest: 'civil' });
    assert.ok(body.includes('BIM and smart-infrastructure'));
  });

  test('ece: appends the ece-specific payoff line', () => {
    const body = buildShortlistBody(bestMatchNiat, { goalPriority: [], coreInterest: 'ece' });
    assert.ok(body.includes('embedded and hardware-adjacent'));
  });

  test('negative: coreInterest null -> no payoff line appended even though NIAT is best-match', () => {
    const body = buildShortlistBody(bestMatchNiat, { goalPriority: [], coreInterest: null });
    assert.ok(!body.includes('robotics and automation'));
    assert.ok(!body.includes('BIM and smart-infrastructure'));
    assert.ok(!body.includes('embedded and hardware-adjacent'));
  });

  test('negative: NIAT in best-match slot is required — a NIAT entry in strong_alternative never gets the payoff', () => {
    const body = buildShortlistBody(bestMatchOther, { goalPriority: [], coreInterest: 'mechanical' });
    assert.ok(!body.includes('robotics and automation'));
  });

  test('the payoff never modifies a non-NIAT best-match college\u2019s own line', () => {
    const body = buildShortlistBody(bestMatchOther, { goalPriority: [], coreInterest: 'mechanical' });
    const plakshaLine = body.split('\n').find((l) => l.includes('Plaksha'));
    assert.ok(!plakshaLine.includes('robotics'));
    assert.ok(!plakshaLine.includes('mechanical'));
  });
});

describe('b5Shortlist — extractB5Action / extractChangeSlotChoice', () => {
  test('recognizes the three B5 button titles', () => {
    assert.equal(extractB5Action('Compare them'), 'compare');
    assert.equal(extractB5Action('Just the best fit'), 'best_only');
    assert.equal(extractB5Action('Change something'), 'change');
    assert.equal(extractB5Action('I like blue'), null);
  });

  test('recognizes the four change-slot menu rows', () => {
    assert.equal(extractChangeSlotChoice('Budget'), 'budgetBand');
    assert.equal(extractChangeSlotChoice('Location'), 'cityPref');
    assert.equal(extractChangeSlotChoice('Field'), 'branchInterest');
    assert.equal(extractChangeSlotChoice('What matters'), 'goalPriority');
    assert.equal(extractChangeSlotChoice('I like blue'), null);
  });
});

describe('b5Shortlist — handleB5Reply (button branches)', () => {
  test('[ Compare them ] advances to B6 with compareMode = full', () => {
    const result = handleB5Reply(ctxWithProfile(STANDARD_PROFILE_PATCH), 'Compare them');
    assert.equal(result.contextPatch.stage, 'b6_awaiting_entry');
    assert.equal(result.contextPatch.compareMode, 'full');
    assert.equal(result.contextPatch.profile.qualification, STANDARD_PROFILE_PATCH.qualification);
  });

  test('[ Just the best fit ] advances to B6 with compareMode = best_only', () => {
    const result = handleB5Reply(ctxWithProfile(STANDARD_PROFILE_PATCH), 'Just the best fit');
    assert.equal(result.contextPatch.stage, 'b6_awaiting_entry');
    assert.equal(result.contextPatch.compareMode, 'best_only');
  });

  test('[ Change something ] shows the 4-row change-slot menu', () => {
    const result = handleB5Reply(ctxWithProfile(STANDARD_PROFILE_PATCH), 'Change something');
    assert.equal(result.contextPatch.stage, 'b5_change_awaiting_slot');
    assert.equal(result.interactive.type, 'list');
    assert.deepEqual(
      result.interactive.sections[0].rows.map((r) => r.title),
      ['Budget', 'Location', 'Field', 'What matters']
    );
  });

  test('ambiguous free text re-asks with the same 3 buttons, stage stays b5_awaiting_reply', () => {
    const result = handleB5Reply(ctxWithProfile(STANDARD_PROFILE_PATCH), 'hmm not sure');
    assert.equal(result.contextPatch.stage, 'b5_awaiting_reply');
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), B5_BUTTONS.map((b) => b.title));
  });
});

describe('b5Shortlist — Change-something loop', () => {
  function changeSlotCtx(slot, profilePatch = {}) {
    return { flowV2: { stage: 'b5_change_awaiting_value', changingSlot: slot, profile: { ...emptyFlowV2Profile(), ...STANDARD_PROFILE_PATCH, ...profilePatch } } };
  }

  test('changing Budget re-runs the matrix and stays on b5_awaiting_reply, never resets to b1_awaiting_reply', () => {
    const result = handleB5Reply(changeSlotCtx('budgetBand'), 'Under \u20B92L');
    assert.equal(result.contextPatch.stage, 'b5_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b1_awaiting_reply');
    assert.equal(result.contextPatch.profile.budgetBand, 'under_2l');
    assert.equal(result.contextPatch.profile.scholarshipFlag, true);
    assert.ok(result.contextPatch.profile.shortlist.length > 0);
  });

  test('changing Field to core engineering does NOT re-trigger the B2.2 fork', () => {
    const result = handleB5Reply(changeSlotCtx('branchInterest'), 'Core engineering (mech, civil, ECE)');
    // Must land back on B5's own awaiting-reply stage, never a core-fork stage.
    assert.equal(result.contextPatch.stage, 'b5_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b2_core_exit_awaiting_reply');
    // branchInterest resolves to 'ECE' per the documented BRANCH_KEYWORD_MAP order.
    assert.equal(result.contextPatch.profile.branchInterest, 'ECE');
    // The fork's own bookkeeping flags must remain untouched by this path.
    assert.equal(result.contextPatch.profile.coreBridgeAttempted, null);
    assert.equal(result.contextPatch.profile.coreBridgeClosed, null);
  });

  test('changing "What matters" REPLACES goalPriority, does not accumulate onto the old list', () => {
    const result = handleB5Reply(changeSlotCtx('goalPriority', { goalPriority: ['placement'] }), 'Affordable fees');
    assert.ok(!result.contextPatch.profile.goalPriority.includes('placement'));
    assert.ok(result.contextPatch.profile.goalPriority.includes('affordable') || result.contextPatch.profile.goalPriority.includes('fee'));
  });

  test('changing Location accepts a relocation-stance tap', () => {
    const result = handleB5Reply(changeSlotCtx('cityPref'), 'Open to move');
    assert.equal(result.contextPatch.profile.cityPref, 'open_to_move');
    assert.equal(result.contextPatch.stage, 'b5_awaiting_reply');
  });

  test('an unrecognized slot choice at the menu re-shows the menu rather than defaulting', () => {
    const ctx = { flowV2: { stage: 'b5_change_awaiting_slot', profile: { ...emptyFlowV2Profile(), ...STANDARD_PROFILE_PATCH } } };
    const result = handleB5Reply(ctx, 'I dunno');
    assert.equal(result.contextPatch.stage, 'b5_change_awaiting_slot');
  });

  test('an unrecognized value re-asks the same slot\u2019s own question, does not silently give up', () => {
    const result = handleB5Reply(changeSlotCtx('budgetBand'), 'whatever is fine I guess');
    assert.equal(result.contextPatch.stage, 'b5_change_awaiting_value');
    assert.equal(result.contextPatch.profile.budgetBand, STANDARD_PROFILE_PATCH.budgetBand);
  });

  test('contextPatch carries profile forward through the full change -> recompute chain', () => {
    const result = handleB5Reply(changeSlotCtx('budgetBand', { qualification: 'Class 12 (MPC)' }), '\u20B95L+');
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
  });
});

describe('B5 — end-to-end through the full dispatcher', () => {
  test('B4 -> B5 -> [Compare them] -> B6 stage handoff, driven entirely through processFlowV2Turn', async () => {
    let ctx = { flowV2: { stage: 'b5_awaiting_entry', profile: { ...emptyFlowV2Profile(), ...STANDARD_PROFILE_PATCH } } };
    let result = await processFlowV2Turn(ctx, 'hi');
    assert.equal(result.contextPatch.stage, 'b5_awaiting_reply');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Compare them');
    assert.equal(result.contextPatch.stage, 'b6_awaiting_entry');
    assert.equal(result.contextPatch.compareMode, 'full');
  });
});
