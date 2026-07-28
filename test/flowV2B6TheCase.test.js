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
} = require('../services/chatbot/flowV2/nodes/b6TheCase');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { handleB5Entry } = require('../services/chatbot/flowV2/nodes/b5Shortlist');
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

  test('produces a "*How they compare*" body reusing the real comparison engine', () => {
    const { text, comparedNames } = buildComparisonMessage(profileWithShortlist());
    assert.ok(text.includes('*How they compare*'));
    assert.deepEqual(comparedNames, ['NIAT (NxtWave Institute of Advanced Technologies)', 'Plaksha University', 'Scaler School of Technology']);
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
  test('recommendation text names the college and lists bullets', () => {
    const text = buildRecommendationText(SAMPLE_SHORTLIST[0], { goalPriority: ['placement'], budgetBand: '2_5l' });
    assert.ok(text.includes('NIAT'));
    assert.ok(text.includes('\u2022'));
  });

  test('vision bubble is present-tense and names the college', () => {
    const text = buildVisionBubble(SAMPLE_SHORTLIST[0], { goalPriority: ['placement'] });
    assert.ok(text.includes('Picture your first semester'));
    assert.ok(text.includes('NIAT'));
  });
});

describe('b6TheCase — handleB6Entry', () => {
  test('compareMode = best_only skips the comparison message entirely (2 bubbles, not 3)', () => {
    const result = handleB6Entry({ flowV2: { compareMode: 'best_only', profile: profileWithShortlist() } });
    assert.equal(result.replyParts.length, 2);
    assert.ok(!result.replyParts.some((p) => p.includes('*How they compare*')));
    assert.equal(result.contextPatch.profile.comparedColleges.length, 0);
  });

  test('compareMode = full includes the comparison message first (3 bubbles)', () => {
    const result = handleB6Entry({ flowV2: { compareMode: 'full', profile: profileWithShortlist() } });
    assert.equal(result.replyParts.length, 3);
    assert.ok(result.replyParts[0].includes('*How they compare*'));
    assert.ok(result.contextPatch.profile.comparedColleges.length > 0);
  });

  test('3 bubbles / 0 gates: no interactive attached, no reply required between bubbles in the same turn', () => {
    const result = handleB6Entry({ flowV2: { compareMode: 'full', profile: profileWithShortlist() } });
    assert.equal(result.interactive, null);
    assert.equal(result.replyText, null);
    assert.ok(Array.isArray(result.replyParts));
  });

  test('no hesitation question exists anywhere in the output', () => {
    const result = handleB6Entry({ flowV2: { compareMode: 'full', profile: profileWithShortlist() } });
    for (const part of result.replyParts) {
      assert.ok(!/hesitat/i.test(part), `unexpected hesitation copy: ${part}`);
      assert.ok(!/any last/i.test(part));
    }
  });

  test('sets stage to b7_awaiting_entry and writes profile.recommendation to the best-match college', () => {
    const result = handleB6Entry({ flowV2: { compareMode: 'best_only', profile: profileWithShortlist() } });
    assert.equal(result.contextPatch.stage, 'b7_awaiting_entry');
    assert.equal(result.contextPatch.profile.recommendation, 'NIAT (NxtWave Institute of Advanced Technologies)');
  });

  test('REGRESSION (propagation-bug shape): contextPatch carries an unrelated profile field forward', () => {
    const result = handleB6Entry({
      flowV2: { compareMode: 'best_only', profile: profileWithShortlist(SAMPLE_SHORTLIST, { qualification: 'Class 12 (MPC)' }) },
    });
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
  });

  test('defensive: an empty shortlist (B6 reached without B5 ever running) does not crash', () => {
    const result = handleB6Entry({ flowV2: { compareMode: 'best_only', profile: profileWithShortlist([]) } });
    assert.equal(result.contextPatch.stage, 'b5_awaiting_entry');
    assert.ok(typeof result.replyText === 'string');
  });

  test('GUARDRAIL: throws when the real assembled recommendation text contains forbidden language injected via profile.shortlist data (not a mocked function)', () => {
    const poisonedShortlist = [
      { collegeName: 'Test University', tier: 'best_match', matchScore: 0.9, why: 'This college has guaranteed placement for every student.' },
    ];
    assert.throws(
      () => handleB6Entry({ flowV2: { compareMode: 'best_only', profile: profileWithShortlist(poisonedShortlist) } }),
      /Flow v2 guardrail violation/
    );
  });

  test('GUARDRAIL: also fires in full compareMode (thrown before the vision bubble is ever built)', () => {
    const poisonedShortlist = [
      { collegeName: 'Test University', tier: 'best_match', matchScore: 0.9, why: 'We assure 100% admission here.' },
      { collegeName: 'Plaksha University', tier: 'strong_alternative', matchScore: 0.7, why: 'Interdisciplinary tech education.' },
    ];
    assert.throws(
      () => handleB6Entry({ flowV2: { compareMode: 'full', profile: profileWithShortlist(poisonedShortlist) } }),
      /Flow v2 guardrail violation/
    );
  });

  test('does not export a handleB6Reply — B6 has no student decision point of its own this phase', () => {
    const mod = require('../services/chatbot/flowV2/nodes/b6TheCase');
    assert.equal(mod.handleB6Reply, undefined);
  });
});

describe('B5/B6 — full chained transition through the dispatcher (B5 -> B6 -> B7)', () => {
  test('best_only path drains B6+B7 in the same turn after Just the best fit', async () => {
    let profile = { ...emptyFlowV2Profile(), qualification: 'Class 12 (MPC)', goalPriority: ['placement'], branchInterest: 'cse_ai', budgetBand: '2_5l', cityPref: 'Hyderabad' };
    let ctx = { flowV2: { stage: 'b5_awaiting_entry', profile } };
    let result = await processFlowV2Turn(ctx, 'hi');
    assert.equal(result.contextPatch.stage, 'b5_awaiting_reply');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Just the best fit');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    assert.equal(result.contextPatch.compareMode, 'best_only');
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    assert.ok(result.contextPatch.profile.recommendation);
    assert.ok(result.interactive || (result.replyParts && result.replyParts.length));
  });

  test('full-compare path produces the case bubbles and lands on B7 booking in one turn', async () => {
    let profile = { ...emptyFlowV2Profile(), goalPriority: ['ai_future_tech'], branchInterest: 'cse_ai', budgetBand: '2_5l', cityPref: 'Hyderabad' };
    let ctx = { flowV2: { stage: 'b5_awaiting_entry', profile } };
    let result = await processFlowV2Turn(ctx, 'hi');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Compare them');
    assert.equal(result.contextPatch.stage, 'b7_awaiting_reply');
    assert.ok((result.replyParts || []).length >= 3);
  });
});
