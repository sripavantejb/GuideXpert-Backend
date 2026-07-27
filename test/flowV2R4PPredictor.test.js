'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleR4PEntry,
  handleR4PReply,
  isBlockedDemographic,
  resolveApTsCategoryId,
  R4P_BLOCKED_STAGE,
  BLOCKED_REPLY_TEXT,
  BLOCKED_BUTTONS,
  RECONNECT_BUTTONS,
  RECONNECT_PROMPT_TEXT,
  CHECKLIST_TEXT,
} = require('../services/chatbot/flowV2/nodes/r4pPredictor');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { detectOverrideIntent } = require('../services/chatbot/flowV2/nodes/node0Override');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { AP_TS_CATEGORY_OPTIONS } = require('../services/chatbot/whatsappCollegePredictor/apTs');

function profileWith(patch) {
  return { ...emptyFlowV2Profile(), ...patch };
}

/**
 * STAGE 1 of R4-P's staged build \u2014 the \u2460 blocked-demographic case ONLY.
 * See r4pPredictor.js's module doc for the full staging plan; slot-
 * filling / prediction / sticky-results / the bridge are all later
 * stages and deliberately have no tests here yet.
 */

describe('R4-P \u2460 blocked case \u2014 fires first, before any slot question, for every AP EAMCET+OC+Male input shape', () => {
  const blockedShapes = [
    { name: 'category as label "OC", lowercase gender', profile: { examType: 'AP_EAMCET', category: 'OC', gender: 'male' } },
    { name: 'category as lowercase label "oc"', profile: { examType: 'AP_EAMCET', category: 'oc', gender: 'male' } },
    { name: 'gender cased "Male"', profile: { examType: 'AP_EAMCET', category: 'OC', gender: 'Male' } },
    { name: 'gender cased "MALE"', profile: { examType: 'AP_EAMCET', category: 'OC', gender: 'MALE' } },
    { name: 'category as numeric string "1"', profile: { examType: 'AP_EAMCET', category: '1', gender: 'male' } },
    { name: 'category as bare number 1', profile: { examType: 'AP_EAMCET', category: 1, gender: 'male' } },
    {
      name: 'rest of the profile completely empty otherwise (sparsest possible blocked shape)',
      profile: { examType: 'AP_EAMCET', category: 'OC', gender: 'male' },
    },
    {
      name: 'rest of the profile fully populated with unrelated fields',
      profile: {
        examType: 'AP_EAMCET',
        category: 'OC',
        gender: 'male',
        qualification: 'Class 12 (MPC)',
        goalPriority: ['placement'],
        branchInterest: 'cse_ai',
        budgetBand: '2_5l',
        cityPref: 'Hyderabad',
        rank: 45000,
      },
    },
  ];

  for (const { name, profile } of blockedShapes) {
    test(`blocked: ${name}`, () => {
      const ctx = { flowV2: { profile: profileWith(profile) } };
      const result = handleR4PEntry(ctx);
      assert.equal(result.interactive.body, BLOCKED_REPLY_TEXT);
      assert.deepEqual(
        result.interactive.buttons.map((b) => b.title),
        ['Connect me', 'What should I look for meanwhile?']
      );
      assert.equal(result.contextPatch.stage, R4P_BLOCKED_STAGE);
      assert.equal(result.replyText, null);
    });
  }

  test('THE FIRST CHECK: isBlockedDemographic alone, called with nothing else in the profile, already returns true \u2014 proving the gate needs no other slot to have been filled', () => {
    assert.equal(isBlockedDemographic({ examType: 'AP_EAMCET', category: 'OC', gender: 'male' }), true);
  });

  test('handleR4PEntry never reaches (or throws) the "not yet implemented" Stage-2 stub for a genuinely blocked profile, no matter how incomplete the rest of the profile is', () => {
    const ctx = { flowV2: { profile: { examType: 'AP_EAMCET', category: 'OC', gender: 'male' } } };
    assert.doesNotThrow(() => handleR4PEntry(ctx));
  });

  const notBlockedShapes = [
    { name: 'AP EAMCET + OC + female (girls have their own reservation code, never blocked)', profile: { examType: 'AP_EAMCET', category: 'OC', gender: 'female' } },
    { name: 'TS EAMCET + OC + male (rule is AP-only)', profile: { examType: 'TS_EAMCET', category: 'OC', gender: 'male' } },
    { name: 'AP EAMCET + BC-A + male (rule is OC-only)', profile: { examType: 'AP_EAMCET', category: 'BC-A', gender: 'male' } },
    { name: 'AP EAMCET + OC + gender not yet known', profile: { examType: 'AP_EAMCET', category: 'OC', gender: null } },
    { name: 'category not yet known at all', profile: { examType: 'AP_EAMCET', category: null, gender: 'male' } },
    { name: 'exam not yet known at all', profile: { examType: null, category: 'OC', gender: 'male' } },
    { name: 'completely empty profile', profile: {} },
  ];

  for (const { name, profile } of notBlockedShapes) {
    test(`NOT blocked (negative control): ${name} \u2014 correctly falls through past the gate (and only then hits Stage 2's not-yet-built stub)`, () => {
      const ctx = { flowV2: { profile: profileWith(profile) } };
      assert.throws(() => handleR4PEntry(ctx), /Stage 2 of this node.s staged build.*not implemented yet/);
    });
  }
});

describe('R4-P \u2460 resolveApTsCategoryId \u2014 provenance: reads live from apTs.js\u2019s own AP_TS_CATEGORY_OPTIONS, not a hardcoded/guessed mapping', () => {
  test('resolves EVERY entry currently in AP_TS_CATEGORY_OPTIONS by its own label, to its own id \u2014 proving this is a live lookup against that exact table, not a separately maintained copy', () => {
    for (const opt of AP_TS_CATEGORY_OPTIONS) {
      assert.equal(resolveApTsCategoryId(opt.label), opt.id, `expected label "${opt.label}" to resolve to id ${opt.id}`);
      assert.equal(resolveApTsCategoryId(String(opt.id)), opt.id, `expected numeric-string id "${opt.id}" to resolve to itself`);
      assert.equal(resolveApTsCategoryId(opt.id), opt.id, `expected bare numeric id ${opt.id} to resolve to itself`);
    }
  });

  test('is case- and whitespace-insensitive on the label', () => {
    assert.equal(resolveApTsCategoryId('  oc  '), 1);
    assert.equal(resolveApTsCategoryId('Bc-A'), 2);
  });

  test('returns null for a label that does not exist in the table, an id with no matching entry, and empty/null/undefined input', () => {
    assert.equal(resolveApTsCategoryId('NOT_A_REAL_CATEGORY'), null);
    assert.equal(resolveApTsCategoryId(9999), null);
    assert.equal(resolveApTsCategoryId(''), null);
    assert.equal(resolveApTsCategoryId(null), null);
    assert.equal(resolveApTsCategoryId(undefined), null);
  });

  test('OC specifically resolves to id 1 \u2014 the exact id isApOcMaleBlocked() checks against \u2014 sourced from AP_TS_CATEGORY_OPTIONS[0], not written down independently here', () => {
    const ocOption = AP_TS_CATEGORY_OPTIONS.find((opt) => opt.label === 'OC');
    assert.ok(ocOption, 'test setup sanity: AP_TS_CATEGORY_OPTIONS must still contain an "OC" entry');
    assert.equal(resolveApTsCategoryId('OC'), ocOption.id);
    assert.equal(ocOption.id, 1);
  });
});

describe('R4-P \u2460 blocked case \u2014 never routes to B1, never says the system doesn\u2019t support this', () => {
  test('BLOCKED_REPLY_TEXT contains no "system doesn\u2019t support" / "not supported" language', () => {
    assert.doesNotMatch(BLOCKED_REPLY_TEXT, /doesn.t support|not supported|cannot support/i);
  });

  test('the blocked reply\u2019s contextPatch.stage is never a B1 stage', () => {
    const result = handleR4PEntry({ flowV2: { profile: profileWith({ examType: 'AP_EAMCET', category: 'OC', gender: 'male' }) } });
    assert.notEqual(result.contextPatch.stage, 'greeting_captured_pending_b1');
    assert.notEqual(result.contextPatch.stage, 'b1_awaiting_reply');
  });

  test('the exact verbatim copy from the task spec is used, unmodified', () => {
    assert.equal(
      BLOCKED_REPLY_TEXT,
      "For AP OC male candidates the cutoffs swing enough that I won't give you a number I can't stand behind \u2014 a wrong prediction here could cost you a year. So let me get you to someone who has the actual current data for your combination."
    );
  });
});

describe('R4-P \u2460 blocked case \u2014 [What should I look for meanwhile?] checklist bubble, then re-offers [Connect me]', () => {
  test('tapping the checklist button returns the 3-item checklist, then a single re-offered [Connect me] button', () => {
    const ctx = { flowV2: { stage: R4P_BLOCKED_STAGE, profile: profileWith({ examType: 'AP_EAMCET', category: 'OC', gender: 'male' }) } };
    const result = handleR4PReply(ctx, 'What should I look for meanwhile?');
    assert.equal(result.replyText, CHECKLIST_TEXT);
    assert.match(result.replyText, /cutoff trend/i);
    assert.match(result.replyText, /seat matrix/i);
    assert.match(result.replyText, /spot-round/i);
    assert.equal(result.interactive.body, RECONNECT_PROMPT_TEXT);
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), ['Connect me']);
    assert.deepEqual(result.interactive.buttons, RECONNECT_BUTTONS);
    assert.equal(result.contextPatch.stage, R4P_BLOCKED_STAGE);
  });

  test('the re-offered [Connect me] button is the literal same button object as the initial offer (same id), not an independent re-typed copy', () => {
    assert.equal(RECONNECT_BUTTONS[0].id, BLOCKED_BUTTONS[0].id);
    assert.equal(RECONNECT_BUTTONS[0].title, BLOCKED_BUTTONS[0].title);
  });

  test('an unrecognized reply while in the blocked stage re-offers the original two-button prompt, never goes silent', () => {
    const ctx = { flowV2: { stage: R4P_BLOCKED_STAGE, profile: profileWith({ examType: 'AP_EAMCET', category: 'OC', gender: 'male' }) } };
    const result = handleR4PReply(ctx, 'asdkjaslkdj random text');
    assert.equal(result.interactive.body, BLOCKED_REPLY_TEXT);
    assert.equal(result.contextPatch.stage, R4P_BLOCKED_STAGE);
  });

  test('profile is carried forward unchanged through both the blocked entry and the checklist reply', () => {
    const profile = profileWith({ examType: 'AP_EAMCET', category: 'OC', gender: 'male', qualification: 'Class 12 (MPC)' });
    const entryResult = handleR4PEntry({ flowV2: { profile } });
    assert.equal(entryResult.contextPatch.profile.qualification, 'Class 12 (MPC)');

    const replyResult = handleR4PReply(
      { flowV2: { stage: R4P_BLOCKED_STAGE, profile: entryResult.contextPatch.profile } },
      'What should I look for meanwhile?'
    );
    assert.equal(replyResult.contextPatch.profile.qualification, 'Class 12 (MPC)');
  });
});

describe('R4-P \u2460 blocked case \u2014 [Connect me] routes through Node 0\u2019s existing handoff machinery, not a duplicate path', () => {
  test('detectOverrideIntent already recognizes the exact button title "Connect me" (Node 0\u2019s existing, unmodified pattern list)', () => {
    assert.equal(detectOverrideIntent('Connect me'), true);
  });

  test('handleR4PReply itself has NO branch that produces a Node-0-shaped (booking link) response for "Connect me" \u2014 proving there is no duplicate/parallel handoff path built into this node', () => {
    const ctx = { flowV2: { stage: R4P_BLOCKED_STAGE, profile: profileWith({ examType: 'AP_EAMCET', category: 'OC', gender: 'male' }) } };
    const result = handleR4PReply(ctx, 'Connect me');
    // This is the SAME shape as any other unrecognized reply at this
    // stage \u2014 the re-offered blocked prompt, NOT a booking link. Proves
    // this function does not special-case "Connect me" at all.
    assert.equal(result.interactive.body, BLOCKED_REPLY_TEXT);
    assert.doesNotMatch(result.replyText || '', /booking form/i);
    assert.notEqual(result.contextPatch.stage, 'node0_awaiting_backfill');
  });

  test('END-TO-END, with ZERO changes to flowV2Dispatcher.js: tapping [Connect me] while at R4-P\u2019s blocked stage already produces Node 0\u2019s real booking-link handoff, because the dispatcher\u2019s existing Node 0 pre-empt fires for any non-b7_* stage regardless of whether that stage has a real handler wired in yet', async () => {
    const ctx = { flowV2: { stage: R4P_BLOCKED_STAGE, profile: profileWith({ examType: 'AP_EAMCET', category: 'OC', gender: 'male' }) } };
    const result = await processFlowV2Turn(ctx, 'Connect me');

    assert.match(result.replyText, /guidexpert\.co\.in\/one-on-one-session/);
    assert.equal(result.contextPatch.stage, 'node0_awaiting_backfill');
    assert.equal(result.contextPatch.profile.bookingStatus, 'link_sent');
    assert.equal(result.contextPatch.profile.temperature, 'hot');
    // The AP/OC/male facts the student already gave R4-P are NOT lost by
    // this handoff \u2014 Node 0's merge is additive, same guarantee every
    // other beat has.
    assert.equal(result.contextPatch.profile.examType, 'AP_EAMCET');
    assert.equal(result.contextPatch.profile.category, 'OC');
    assert.equal(result.contextPatch.profile.gender, 'male');
  });

  test('the SAME end-to-end path works from a completely fresh stage name too (proves this is a general dispatcher property, not something specific to R4P_BLOCKED_STAGE\u2019s exact string)', async () => {
    const ctx = { flowV2: { stage: 'r4p_some_future_stage_name', profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'Connect me');
    assert.equal(result.contextPatch.stage, 'node0_awaiting_backfill');
  });
});
