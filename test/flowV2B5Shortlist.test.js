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

describe('b5Shortlist — handleB5Entry (V3 B8 medal shortlist)', () => {
  test('produces FIT ask with 5-college shortlist in one interactive (no Best Match tiers)', () => {
    const result = handleB5Entry(ctxWithProfile(STANDARD_PROFILE_PATCH));
    assert.equal(result.interactive.type, 'button');
    assert.ok(
      result.interactive.buttons.some((b) => /help me|explore/i.test(b.title)),
      'expected B9 FIT buttons'
    );
    const visible = [...(result.replyParts || []), result.replyText, result.interactive?.body]
      .filter(Boolean)
      .join('\n');
    assert.doesNotMatch(visible, /\*Best Match\*/i);
    assert.match(visible, /worth exploring|Newton School|🥇/i);
    assert.match(visible, /Polar School of Technology/i);
    assert.match(visible, /best fit/i);
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    assert.ok(Array.isArray(result.contextPatch.profile.shortlist));
    assert.equal(result.contextPatch.profile.shortlist.length, 5);
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

  test('mechanical: appends the honest CSE/AI door payoff — never an unverified robotics curriculum claim', () => {
    const body = buildShortlistBody(bestMatchNiat, { goalPriority: [], coreInterest: 'mechanical' });
    assert.ok(body.includes('wider CSE/AI door'));
    assert.ok(!body.includes('robotics and automation'));
    const niatLine = body.split('\n').find((l) => l.includes('NIAT'));
    assert.ok(niatLine.includes('leaning mechanical'));
  });

  test('civil: appends the civil-specific honest payoff', () => {
    const body = buildShortlistBody(bestMatchNiat, { goalPriority: [], coreInterest: 'civil' });
    assert.ok(body.includes('leaning civil'));
    assert.ok(!body.includes('BIM and smart-infrastructure'));
  });

  test('ece: appends the ece-specific honest payoff', () => {
    const body = buildShortlistBody(bestMatchNiat, { goalPriority: [], coreInterest: 'ece' });
    assert.ok(body.includes('leaning ECE'));
    assert.ok(!body.includes('embedded and hardware-adjacent'));
  });

  test('negative: coreInterest null -> no payoff line appended even though NIAT is best-match', () => {
    const body = buildShortlistBody(bestMatchNiat, { goalPriority: [], coreInterest: null });
    assert.ok(!body.includes('wider CSE/AI door'));
    assert.ok(!body.includes('leaning mechanical'));
  });

  test('negative: NIAT in best-match slot is required — a NIAT entry in strong_alternative never gets the payoff', () => {
    const body = buildShortlistBody(bestMatchOther, { goalPriority: [], coreInterest: 'mechanical' });
    assert.ok(!body.includes('leaning mechanical'));
  });

  test('the payoff never modifies a non-NIAT best-match college\u2019s own line', () => {
    const body = buildShortlistBody(bestMatchOther, { goalPriority: [], coreInterest: 'mechanical' });
    const plakshaLine = body.split('\n').find((l) => l.includes('Plaksha'));
    assert.ok(!plakshaLine.includes('robotics'));
    assert.ok(!plakshaLine.includes('mechanical'));
  });

  test('invariant: shortlist copy never ships unverified NIAT robotics / automation curriculum claims', () => {
    for (const interest of ['mechanical', 'civil', 'ece']) {
      const body = buildShortlistBody(bestMatchNiat, { goalPriority: [], coreInterest: interest });
      assert.ok(!/\brobotics\b/i.test(body));
      assert.ok(!/\bautomation\b/i.test(body));
    }
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

describe('b5Shortlist — handleB5Reply (V3 B8/B9)', () => {
  test('"compare them" shows on-tap compare table and stays on FIT ask', () => {
    const seeded = handleB5Entry(ctxWithProfile(STANDARD_PROFILE_PATCH));
    const result = handleB5Reply(
      {
        flowV2: {
          stage: 'b9_awaiting_reply',
          profile: seeded.contextPatch.profile,
        },
      },
      'Compare them'
    );
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    assert.match(result.replyText || '', /stack up/i);
  });

  test('"Yes, help me" delivers rich NIAT pitch then interest ask (not booking yet)', () => {
    const seeded = handleB5Entry(ctxWithProfile(STANDARD_PROFILE_PATCH));
    const result = handleB5Reply(
      {
        flowV2: {
          stage: 'b9_awaiting_reply',
          profile: seeded.contextPatch.profile,
        },
      },
      'Yes, help me'
    );
    assert.equal(result.contextPatch.stage, 'b9_niat_interest_awaiting_reply');
    assert.equal(result.contextPatch.profile.fitCollege, 'niat');
    const visible = [...(result.replyParts || []), result.replyText, result.interactive?.body]
      .filter(Boolean)
      .join('\n');
    assert.match(visible, /\bNIAT\b/i);
    assert.match(visible, /Curriculum|partner|Internship|Placement support|interested/i);
    assert.doesNotMatch(visible, /Book My Session|IITian/);
  });

  test('NIAT pitch highlights the student\'s selected interests and priorities', () => {
    const { buildNiatCounsellorPitch } = require('../services/chatbot/flowV2/nodes/b9Fit');
    const pitch = buildNiatCounsellorPitch({
      ...emptyFlowV2Profile(),
      interests: ['computers_software', 'web_development', 'artificial_intelligence'],
      interestCluster: 'software',
      goalPriority: ['placements', 'internships'],
    });
    assert.match(pitch, /Computers & software/i);
    assert.match(pitch, /Web Development/i);
    assert.match(pitch, /Artificial Intelligence/i);
    assert.match(pitch, /Placements/i);
    assert.match(pitch, /Internships/i);
    assert.match(pitch, /How NIAT lines up with \*your\* picks/i);
    assert.match(pitch, /✅ \*💻 Computers & software\*/);
    assert.match(pitch, /✅ \*💼 Placements\*/);
    // Placement + internship sections use ✅ bullets when those aspects were selected
    assert.match(pitch, /✅ Mock interviews/);
    assert.match(pitch, /✅ Internships can start early/);
  });

  test('wider catalog ask returns partner list without Best Match tiers', () => {
    const seeded = handleB5Entry(ctxWithProfile(STANDARD_PROFILE_PATCH));
    const result = handleB5Reply(
      {
        flowV2: {
          stage: 'b9_awaiting_reply',
          profile: seeded.contextPatch.profile,
        },
      },
      'show me all options'
    );
    assert.match(result.replyText || '', /Masters' Union|UPES|SRM AP/i);
    assert.doesNotMatch(result.replyText || '', /\*Best Match\*/i);
  });

  test('ambiguous free text re-asks FIT buttons', () => {
    const seeded = handleB5Entry(ctxWithProfile(STANDARD_PROFILE_PATCH));
    const result = handleB5Reply(
      {
        flowV2: {
          stage: 'b9_awaiting_reply',
          profile: seeded.contextPatch.profile,
        },
      },
      'hmm not sure'
    );
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    assert.equal(result.interactive?.type, 'button');
  });
});

describe('b5Shortlist — Change-something loop', () => {
  function changeSlotCtx(slot, profilePatch = {}) {
    return {
      flowV2: {
        stage: 'b5_change_awaiting_value',
        changingSlot: slot,
        profile: { ...emptyFlowV2Profile(), ...STANDARD_PROFILE_PATCH, ...profilePatch },
      },
    };
  }

  test('changing Budget re-runs into V3 flat shortlist/FIT, never resets to b1', () => {
    const result = handleB5Reply(changeSlotCtx('budgetBand'), 'Under \u20B92L');
    assert.ok(
      result.contextPatch.stage === 'b9_awaiting_reply' || result.contextPatch.stage === 'b5_awaiting_reply',
      result.contextPatch.stage
    );
    assert.notEqual(result.contextPatch.stage, 'b1_awaiting_reply');
    assert.equal(result.contextPatch.profile.budgetBand, 'under_2l');
    assert.equal(result.contextPatch.profile.scholarshipFlag, true);
    assert.ok(result.contextPatch.profile.shortlist.length > 0);
  });

  test('changing Field to core engineering does NOT re-trigger the B2.2 fork', () => {
    const result = handleB5Reply(changeSlotCtx('branchInterest'), 'Core engineering (mech, civil, ECE)');
    assert.notEqual(result.contextPatch.stage, 'b2_core_fork_awaiting_reply');
    assert.notEqual(result.contextPatch.stage, 'b2_core_exit_awaiting_reply');
    assert.equal(result.contextPatch.profile.branchInterest, 'ECE');
    assert.equal(result.contextPatch.profile.coreBridgeAttempted, null);
    assert.equal(result.contextPatch.profile.coreBridgeClosed, null);
  });

  test('changing "What matters" REPLACES goalPriority, does not accumulate onto the old list', () => {
    const result = handleB5Reply(changeSlotCtx('goalPriority', { goalPriority: ['placement'] }), 'Affordable fees');
    assert.ok(!result.contextPatch.profile.goalPriority.includes('placement'));
    assert.ok(
      result.contextPatch.profile.goalPriority.includes('affordable') ||
        result.contextPatch.profile.goalPriority.includes('fee')
    );
  });

  test('changing Location accepts a relocation-stance tap', () => {
    const result = handleB5Reply(changeSlotCtx('cityPref'), 'Open to move');
    assert.equal(result.contextPatch.profile.cityPref, 'open_to_move');
  });

  test('an unrecognized slot choice at the menu re-shows the menu rather than defaulting', () => {
    const ctx = {
      flowV2: {
        stage: 'b5_change_awaiting_slot',
        profile: { ...emptyFlowV2Profile(), ...STANDARD_PROFILE_PATCH },
      },
    };
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
  test('B8 entry drains to FIT; yes narrow → NIAT interest → B10 booking CTA', async () => {
    let ctx = {
      flowV2: { stage: 'b5_awaiting_entry', profile: { ...emptyFlowV2Profile(), ...STANDARD_PROFILE_PATCH } },
    };
    let result = await processFlowV2Turn(ctx, 'hi');
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    const visible = [...(result.replyParts || []), result.replyText, result.interactive?.body]
      .filter(Boolean)
      .join('\n');
    assert.doesNotMatch(visible, /\*Best Match\*/i);

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Yes, help me');
    assert.equal(result.contextPatch.stage, 'b9_niat_interest_awaiting_reply');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, "Yes, I'm interested");
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    assert.ok(result.interactive || (result.replyParts && result.replyParts.length));
    const afterInterest = [...(result.replyParts || []), result.replyText, result.interactive?.body]
      .filter(Boolean)
      .join('\n');
    assert.match(afterInterest, /IITian|book your session/i);

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'flowv2_b7_book');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_done');
    assert.match(result.replyText || '', /guidexpert\.co\.in\/one-on-one-session/i);
  });

  test('stuck b9_awaiting_reply after NIAT pitch still advances interest → book invite → link', async () => {
    const profile = {
      ...emptyFlowV2Profile(),
      ...STANDARD_PROFILE_PATCH,
      fitCollege: 'niat',
      recommendation: 'niat',
      niatInterest: null,
    };
    let result = await processFlowV2Turn(
      { flowV2: { stage: 'b9_awaiting_reply', profile } },
      'flowv2_b9_niat_yes'
    );
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    assert.equal(result.contextPatch.profile.niatInterest, true);
    assert.match(result.interactive.body, /book.*session|IITian/i);

    result = await processFlowV2Turn(
      { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } },
      'flowv2_b7_book'
    );
    assert.equal(result.contextPatch.stage, 'b7_awaiting_done');
    assert.match(result.replyText || '', /guidexpert\.co\.in\/one-on-one-session/i);
  });
});
