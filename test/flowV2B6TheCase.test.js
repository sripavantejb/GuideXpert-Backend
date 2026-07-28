'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleB6Entry,
  selectCollegesForComparison,
  buildComparisonMessage,
  buildWhyBullets,
  buildRecommendationText,
  buildVisionBubble,
  WEAK_CONFIDENCE_LINE,
  VISION_BUBBLE,
} = require('../services/chatbot/flowV2/nodes/b6TheCase');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');

const SAMPLE_SHORTLIST = [
  { collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)', tier: 'best_match', matchScore: 0.9, why: 'AI-first curriculum with real projects.' },
  { collegeName: 'Plaksha University', tier: 'strong_alternative', matchScore: 0.75, why: 'Interdisciplinary tech education.' },
  { collegeName: 'Scaler School of Technology', tier: 'strong_alternative', matchScore: 0.7, why: 'Extensive mentorship.' },
  { collegeName: 'SRM AP University', tier: 'worth_exploring', matchScore: 0.5, why: 'Industry partnerships.' },
];

function profileWithShortlist(shortlist = SAMPLE_SHORTLIST, patch = {}) {
  return { ...emptyFlowV2Profile(), shortlist, goalPriority: ['placement'], branchInterest: 'cse_ai', budgetBand: '2_5l', ...patch };
}

describe('b6TheCase — selectCollegesForComparison', () => {
  test('includes best_match and strong_alternative, excludes worth_exploring', () => {
    const selected = selectCollegesForComparison(SAMPLE_SHORTLIST);
    assert.deepEqual(
      selected.map((c) => c.collegeName),
      ['NIAT (NxtWave Institute of Advanced Technologies)', 'Plaksha University', 'Scaler School of Technology']
    );
  });
});

describe('b6TheCase — buildComparisonMessage', () => {
  test('returns null text when fewer than 2 colleges are comparable', () => {
    const { text } = buildComparisonMessage(profileWithShortlist([SAMPLE_SHORTLIST[0]]));
    assert.equal(text, null);
  });

  test('produces an MD factor ●●● table for the top 3', () => {
    const { text, comparedNames } = buildComparisonMessage(profileWithShortlist());
    assert.ok(text.includes("Here's how your top 3 stack up on what you care about"));
    assert.ok(text.includes('Factor'));
    assert.ok(text.includes('●●●'));
    assert.ok(!text.includes('*How they compare*'));
    assert.deepEqual(comparedNames, [
      'NIAT (NxtWave Institute of Advanced Technologies)',
      'Plaksha University',
      'Scaler School of Technology',
    ]);
  });
});

describe('b6TheCase — buildWhyBullets', () => {
  test('produces 2-3 bullets tied to goalPriority/budgetBand plus the catalog why-blurb', () => {
    const bullets = buildWhyBullets(SAMPLE_SHORTLIST[0], { goalPriority: ['placement'], budgetBand: '2_5l' });
    assert.ok(bullets.length >= 2 && bullets.length <= 3);
    assert.ok(bullets.some((b) => /placement/i.test(b)));
    assert.ok(bullets.includes('AI-first curriculum with real projects.'));
  });

  test('falls back to a generic bullet when no goalPriority/budgetBand signal is available', () => {
    const bullets = buildWhyBullets({ collegeName: 'X', why: null }, {});
    assert.ok(bullets.length >= 1);
  });
});

describe('b6TheCase — buildRecommendationText / buildVisionBubble', () => {
  test('recommendation uses pick-one copy, name, weak-confidence, and bullets', () => {
    const text = buildRecommendationText(SAMPLE_SHORTLIST[0], {
      name: 'Rahul',
      goalPriority: ['placement'],
      budgetBand: '2_5l',
    });
    assert.ok(text.includes('If I had to pick one for you, Rahul — *NIAT'));
    assert.ok(text.includes('\u2022'));
    assert.ok(text.includes(WEAK_CONFIDENCE_LINE));
  });

  test('vision bubble is MD possibility copy without naming a college', () => {
    const text = buildVisionBubble();
    assert.equal(text, VISION_BUBBLE);
    assert.ok(text.includes('Picture your first semester'));
    assert.ok(!text.includes('NIAT'));
  });
});

describe('b6TheCase — handleB6Entry (V3 delegates to B9 FIT)', () => {
  test('shows FIT ask buttons', () => {
    const result = handleB6Entry({ flowV2: { profile: profileWithShortlist() } });
    assert.equal(result.interactive?.type, 'button');
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    assert.match(result.interactive.body, /narrow it down/i);
  });

  test('no hesitation question exists anywhere in the output', () => {
    const result = handleB6Entry({ flowV2: { profile: profileWithShortlist() } });
    const text = [result.replyText, result.interactive?.body, ...(result.replyParts || [])]
      .filter(Boolean)
      .join('\n');
    assert.ok(!/hesitat/i.test(text));
    assert.ok(!/any last/i.test(text));
  });

  test('REGRESSION (propagation-bug shape): contextPatch carries an unrelated profile field forward', () => {
    const result = handleB6Entry({
      flowV2: { profile: profileWithShortlist(SAMPLE_SHORTLIST, { qualification: 'Class 12 (MPC)' }) },
    });
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
  });

  test('defensive: an empty shortlist still shows FIT ask (does not crash)', () => {
    const result = handleB6Entry({ flowV2: { profile: profileWithShortlist([]) } });
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    assert.equal(result.interactive?.type, 'button');
  });

  test('still exports handleB6Entry for dispatcher compatibility', () => {
    const mod = require('../services/chatbot/flowV2/nodes/b6TheCase');
    assert.equal(typeof mod.handleB6Entry, 'function');
  });
});

describe('B8/B9 — full chained transition through the dispatcher', () => {
  test('flat shortlist drains to FIT; yes narrow lands on B10 booking', async () => {
    let profile = {
      ...emptyFlowV2Profile(),
      qualification: 'Class 12 (MPC)',
      goalPriority: ['placement'],
      branchInterest: 'cse_ai',
      interestCluster: 'software',
      budgetBand: '2_5l',
      cityPref: 'Hyderabad',
    };
    let ctx = { flowV2: { stage: 'b5_awaiting_entry', profile } };
    let result = await processFlowV2Turn(ctx, 'hi');
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    const visible = [...(result.replyParts || []), result.replyText, result.interactive?.body]
      .filter(Boolean)
      .join('\n');
    assert.doesNotMatch(visible, /\*Best Match\*/i);

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Yes, narrow it down');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    assert.ok(result.interactive || (result.replyParts && result.replyParts.length));
  });

  test('compare-on-tap stays on FIT then yes advances to booking', async () => {
    let profile = {
      ...emptyFlowV2Profile(),
      goalPriority: ['ai_future_tech'],
      branchInterest: 'cse_ai',
      interestCluster: 'data_ai',
      budgetBand: '2_5l',
      cityPref: 'Hyderabad',
    };
    let ctx = { flowV2: { stage: 'b5_awaiting_entry', profile } };
    let result = await processFlowV2Turn(ctx, 'hi');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Compare them');
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    assert.match(result.replyText || '', /stack up/i);

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Yes, narrow it down');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
  });
});
