'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleB3Entry,
  handleB3Reply,
  extractB3BudgetTap,
  extractB3LocationTap,
} = require('../services/chatbot/flowV2/nodes/b3Constraints');
const { BRIDGE_TEXT } = require('../services/chatbot/flowV2/nodes/b4Bridge');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');

function ctxWithProfile(patch = {}) {
  return { flowV2: { profile: { ...emptyFlowV2Profile(), ...patch } } };
}

describe('b3Constraints — extractB3BudgetTap / extractB3LocationTap', () => {
  test('recognizes all three budget buttons distinctly (generic extractor would collapse two of them)', () => {
    assert.equal(extractB3BudgetTap('Under \u20B92L'), 'under_2l');
    assert.equal(extractB3BudgetTap('\u20B92\u20135L'), '2_5l');
    assert.equal(extractB3BudgetTap('\u20B95L+'), '5l_plus');
    assert.equal(extractB3BudgetTap('I like blue'), null);
  });

  test('recognizes all three location buttons as relocation stances', () => {
    assert.equal(extractB3LocationTap('Near home'), 'near_home');
    assert.equal(extractB3LocationTap('Open to move'), 'open_to_move');
    assert.equal(extractB3LocationTap('Metro cities'), 'metro');
    assert.equal(extractB3LocationTap('I like blue'), null);
  });
});

describe('b3Constraints — handleB3Entry (four skip-combination cases)', () => {
  test('case (d) neither filled: asks budget first, stage = b3_awaiting_budget', () => {
    const result = handleB3Entry(ctxWithProfile());
    assert.equal(result.interactive.type, 'button');
    assert.ok(result.interactive.body.includes("comfortable for your family"));
    assert.equal(result.contextPatch.stage, 'b3_awaiting_budget');
    assert.deepEqual(
      result.interactive.buttons.map((b) => b.title),
      ['Under \u20B92L', '\u20B92\u20135L', '\u20B95L+']
    );
  });

  test('case (b) budgetBand filled, cityPref not: asks ONLY the location question, stage = b3_awaiting_location', () => {
    const result = handleB3Entry(ctxWithProfile({ budgetBand: '2_5l' }));
    assert.equal(result.interactive.type, 'button');
    assert.ok(result.interactive.body.includes('Near home, or open to moving'));
    assert.equal(result.contextPatch.stage, 'b3_awaiting_location');
  });

  test('case (b) exact string assertion: the location-only entry ask does NOT contain "Last one"', () => {
    const result = handleB3Entry(ctxWithProfile({ budgetBand: '2_5l' }));
    assert.equal(
      result.interactive.body,
      'Near home, or open to moving?\nWhy I ask: location changes what\u2019s realistic.'
    );
    assert.ok(!result.interactive.body.includes('Last one'));
  });

  test('case (c) cityPref filled, budgetBand not: asks ONLY the budget question (same stage/copy as case d)', () => {
    const result = handleB3Entry(ctxWithProfile({ cityPref: 'Hyderabad' }));
    assert.equal(result.contextPatch.stage, 'b3_awaiting_budget');
    assert.ok(result.interactive.body.includes('comfortable for your family'));
  });

  test('case (a) both already filled: skips B3 entirely, advances straight to B4 in the same turn', () => {
    const result = handleB3Entry(ctxWithProfile({ budgetBand: 'under_2l', cityPref: 'Hyderabad' }));
    assert.equal([...(result.replyParts || []), result.replyText].filter(Boolean).join('\n\n'), BRIDGE_TEXT);
    assert.equal(result.contextPatch.stage, 'b8_shortlist_ask_awaiting_reply');
    assert.equal(result.interactive?.type, 'button');
    assert.match(result.interactive.body, /top 5 colleges/i);
  });

  test('REGRESSION (Phase 4 propagation-bug shape): every entry branch carries a profile mutated by an upstream caller', () => {
    for (const patch of [
      {},
      { budgetBand: '2_5l' },
      { cityPref: 'Hyderabad' },
      { budgetBand: 'under_2l', cityPref: 'Hyderabad' },
    ]) {
      const mutatedProfile = { ...emptyFlowV2Profile(), qualification: 'Class 12 (MPC)', ...patch };
      const result = handleB3Entry({ flowV2: { profile: mutatedProfile } });
      assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)', JSON.stringify(patch));
    }
  });

  test('never sends both budget AND location questions in the same message, even in the "neither filled" case', () => {
    const result = handleB3Entry(ctxWithProfile());
    const body = result.interactive.body;
    assert.ok(body.includes('comfortable for your family'));
    assert.ok(!body.includes('near home'));
    assert.equal(result.replyParts, null);
  });
});

describe('b3Constraints — handleB3Reply (stage = b3_awaiting_budget)', () => {
  test('[ Under \u20B92L ] sets scholarshipFlag = true and asks location with the "Last one" prefix', () => {
    const result = handleB3Reply(ctxWithProfile(), 'Under \u20B92L');
    assert.equal(result.contextPatch.profile.budgetBand, 'under_2l');
    assert.equal(result.contextPatch.profile.scholarshipFlag, true);
    assert.equal(result.contextPatch.stage, 'b3_awaiting_location');
    assert.equal(
      result.interactive.body,
      'Last one \u2014 near home, or open to moving?\nWhy I ask: location changes what\u2019s realistic.'
    );
  });

  test('[ \u20B92\u20135L ] leaves scholarshipFlag at schema default (null), not false', () => {
    const result = handleB3Reply(ctxWithProfile(), '\u20B92\u20135L');
    assert.equal(result.contextPatch.profile.budgetBand, '2_5l');
    assert.equal(result.contextPatch.profile.scholarshipFlag, null);
    assert.notEqual(result.contextPatch.profile.scholarshipFlag, false);
  });

  test('[ \u20B95L+ ] leaves scholarshipFlag at schema default (null), not false', () => {
    const result = handleB3Reply(ctxWithProfile(), '\u20B95L+');
    assert.equal(result.contextPatch.profile.budgetBand, '5l_plus');
    assert.equal(result.contextPatch.profile.scholarshipFlag, null);
  });

  test('never silently defaults budgetBand on an unrecognized reply — re-asks the same budget question', () => {
    const result = handleB3Reply(ctxWithProfile(), 'I have no idea honestly');
    assert.equal(result.contextPatch.profile.budgetBand, null);
    assert.equal(result.contextPatch.stage, 'b3_awaiting_budget');
    assert.ok(result.interactive.body.includes('comfortable for your family'));
  });

  test('defensive: if cityPref is somehow already filled by the time the budget reply arrives, skips location and advances to B4', () => {
    const result = handleB3Reply(ctxWithProfile({ cityPref: 'Hyderabad' }), '\u20B95L+');
    assert.equal([...(result.replyParts || []), result.replyText].filter(Boolean).join('\n\n'), BRIDGE_TEXT);
    assert.equal(result.contextPatch.stage, 'b8_shortlist_ask_awaiting_reply');
    assert.equal(result.contextPatch.profile.budgetBand, '5l_plus');
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
  });

  test('an over-answering budget reply that also names a city is captured and skips straight to B4', () => {
    const result = handleB3Reply(ctxWithProfile(), 'under 2L is fine, I want to stay in Hyderabad');
    assert.equal(result.contextPatch.profile.budgetBand, 'under_2l');
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
    assert.equal(result.contextPatch.stage, 'b8_shortlist_ask_awaiting_reply');
  });

  test('contextPatch carries profile forward on the sequential budget->location transition', () => {
    const result = handleB3Reply(ctxWithProfile({ qualification: 'Class 12 (MPC)' }), 'Under \u20B92L');
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
  });
});

describe('b3Constraints — handleB3Reply (stage = b3_awaiting_location)', () => {
  function locationCtx(patch = {}) {
    return { flowV2: { stage: 'b3_awaiting_location', profile: { ...emptyFlowV2Profile(), budgetBand: 'under_2l', ...patch } } };
  }

  test('Near home asks for the city when state is unknown', () => {
    const result = handleB3Reply(locationCtx(), 'Near home');
    assert.equal(result.contextPatch.profile.cityPref, 'near_home');
    assert.equal(result.replyText, 'Which city are you in?');
    assert.equal(result.contextPatch.stage, 'b3_awaiting_city');
    assert.equal(result.interactive, null);
  });

  test('the follow-up city is stored separately without losing the near-home preference', () => {
    const result = handleB3Reply(
      { flowV2: { stage: 'b3_awaiting_city', profile: { ...emptyFlowV2Profile(), budgetBand: 'under_2l', cityPref: 'near_home' } } },
      'Hyderabad'
    );
    assert.equal(result.contextPatch.profile.cityPref, 'near_home');
    assert.equal(result.contextPatch.profile.city, 'Hyderabad');
    assert.equal(result.contextPatch.stage, 'b8_shortlist_ask_awaiting_reply');
  });

  test('a real city name (free text, not a tap) also resolves correctly', () => {
    const result = handleB3Reply(locationCtx(), 'I want to study in Hyderabad');
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
    assert.equal([...(result.replyParts || []), result.replyText].filter(Boolean).join('\n\n'), BRIDGE_TEXT);
  });

  test('never silently defaults cityPref on an unrecognized reply — re-asks the location question, never sends B4', () => {
    const result = handleB3Reply(locationCtx(), 'not sure honestly');
    assert.equal(result.contextPatch.profile.cityPref, null);
    assert.equal(result.contextPatch.stage, 'b3_awaiting_location');
    assert.notEqual([...(result.replyParts || []), result.replyText].filter(Boolean).join('\n\n'), BRIDGE_TEXT);
  });

  test('this is the LAST question of the beat: no additional B3 question is appended after a location answer', () => {
    const result = handleB3Reply(locationCtx(), 'Open to move');
    // Framing + top-5 ask buttons (not another B3 budget/location question).
    assert.equal(result.interactive?.type, 'button');
    assert.match(result.interactive.body, /top 5 colleges/i);
    const text = [...(result.replyParts || []), result.replyText].filter(Boolean).join('\n');
    assert.match(text, /Traditional Colleges|New-Age Colleges|biggest difference/i);
    assert.doesNotMatch(result.interactive.body, /comfortable for your family|near home/i);
  });

  test('contextPatch carries profile forward on the location->B4 transition', () => {
    const result = handleB3Reply(locationCtx({ qualification: 'Class 12 (MPC)' }), 'Metro cities');
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    assert.equal(result.contextPatch.profile.budgetBand, 'under_2l');
  });
});

describe('b4Bridge — handleB4Entry', () => {
  const { handleB4Entry } = require('../services/chatbot/flowV2/nodes/b4Bridge');

  test('sends V3 two-models frame then asks before top-5 shortlist', () => {
    const result = handleB4Entry(ctxWithProfile());
    const text = [...(result.replyParts || []), result.replyText].filter(Boolean).join('\n\n');
    assert.equal(text, BRIDGE_TEXT);
    assert.match(text, /Traditional Colleges|New-Age Colleges/i);
    assert.equal(result.contextPatch.stage, 'b8_shortlist_ask_awaiting_reply');
    assert.equal(result.contextPatch.profile.frameSent, true);
    assert.equal(result.interactive?.type, 'button');
    assert.match(result.interactive.body, /top 5 colleges/i);
  });

  test('carries profile forward (Phase 4 propagation-bug shape)', () => {
    const result = handleB4Entry(ctxWithProfile({ qualification: 'Class 12 (MPC)', budgetBand: 'under_2l', cityPref: 'Hyderabad' }));
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    assert.equal(result.contextPatch.profile.budgetBand, 'under_2l');
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
  });

  test('exports no reply handler for B4 — only entry + two-models text aliases', () => {
    const mod = require('../services/chatbot/flowV2/nodes/b4Bridge');
    assert.deepEqual(Object.keys(mod).sort(), ['BRIDGE_TEXT', 'TWO_MODELS_TEXT', 'handleB4Entry']);
    assert.equal(mod.handleB4Reply, undefined);
  });
});

describe('B3/B4 — end-to-end through the full dispatcher', () => {
  test('B3 interest tap stays multi-select; done continues into B4 priority', async () => {
    let ctx = { flowV2: { stage: 'b2_awaiting_reply', profile: emptyFlowV2Profile() } };
    let result = await processFlowV2Turn(ctx, 'Computers');
    assert.ok(result.contextPatch.profile.interests?.includes('computers_software'));
    assert.equal(result.contextPatch.stage, 'b2_awaiting_reply');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'done');
    assert.equal(result.contextPatch.profile.branchInterest, 'cse_ai');
    assert.ok(
      result.contextPatch.stage === 'b4_awaiting_reply' ||
        result.contextPatch.stage === 'b4_awaiting_entry' ||
        result.contextPatch.stage === 'b6_permission_awaiting_reply' ||
        result.contextPatch.stage === 'b9_awaiting_reply' ||
        result.contextPatch.stage === 'b5_checklist_awaiting_entry',
      `expected B4 priority or drained checklist/permission, got ${result.contextPatch.stage}`
    );
    const visible = [...(result.replyParts || []), result.replyText, result.interactive?.body]
      .filter(Boolean)
      .join('\n');
    assert.match(visible, /most flexible base/i);
    assert.doesNotMatch(visible, /comfortable for your family/i);
  });

  test('a full budget+location round trip continues through B7 two-models into B8/B9 in the same turn', async () => {
    let ctx = { flowV2: { stage: 'b3_awaiting_budget', profile: emptyFlowV2Profile() } };
    let result = await processFlowV2Turn(ctx, 'Under \u20B92L');
    assert.equal(result.contextPatch.profile.budgetBand, 'under_2l');
    assert.equal(result.contextPatch.stage, 'b3_awaiting_location');

    ctx = { flowV2: { stage: result.contextPatch.stage, profile: result.contextPatch.profile } };
    result = await processFlowV2Turn(ctx, 'Open to move');
    assert.equal(result.contextPatch.profile.cityPref, 'open_to_move');
    assert.ok(
      result.contextPatch.stage === 'b9_awaiting_reply' ||
        result.contextPatch.stage === 'b8_shortlist_ask_awaiting_reply' ||
        result.contextPatch.stage === 'b8_shortlist_ask_awaiting_reply' ||
        result.contextPatch.stage === 'b7_awaiting_reply',
      `expected B8/B9/B10 stage, got ${result.contextPatch.stage}`
    );
    const visible = [
      result.replyText,
      ...(result.replyParts || []),
      result.interactive && result.interactive.body,
    ]
      .filter(Boolean)
      .join('\n');
    assert.match(visible, /Traditional Colleges|New-Age Colleges|top 5 colleges|Newton School|best fit/i);
    assert.doesNotMatch(visible, /\*Best Match\*/i);
  });
});
