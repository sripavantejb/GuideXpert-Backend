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
  // Stage 2
  R4P_SLOT_STAGE,
  R4P_AWAITING_PREDICTION_STAGE,
  resolveLegacyExam,
  getR4PMissingSlots,
  extractR4PAdmissionTypeTap,
} = require('../services/chatbot/flowV2/nodes/r4pPredictor');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { detectOverrideIntent } = require('../services/chatbot/flowV2/nodes/node0Override');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { AP_TS_CATEGORY_OPTIONS, EXAM_AP, EXAM_TS } = require('../services/chatbot/whatsappCollegePredictor/apTs');
const { EXAM_KCET, EXAM_MHT } = require('../constants/whatsappCollegePredictor');

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
    test(`NOT blocked (negative control): ${name} \u2014 correctly falls through past the gate into Stage 2's real slot-filling (never the blocked reply)`, () => {
      const ctx = { flowV2: { profile: profileWith(profile) } };
      let result;
      assert.doesNotThrow(() => {
        result = handleR4PEntry(ctx);
      });
      assert.notEqual(result.contextPatch.stage, R4P_BLOCKED_STAGE);
      assert.notEqual(result.interactive && result.interactive.body, BLOCKED_REPLY_TEXT);
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

/**
 * STAGE 2 of R4-P's staged build \u2014 \u2461 exam-specific slot filling. Ends
 * with "all required slots known"; does NOT call the prediction API and
 * does NOT resolve reservation codes (both Stage 3). See r4pPredictor.js's
 * module doc for the full staging plan and the scope decisions made here
 * (category's shared 10-option list, admissionType's node-local tap).
 */

describe('R4-P \u2461 slot filling \u2014 ORDERING GUARANTEE: the blocked check still runs first, even mid-slot-filling, even when the SAME reply would otherwise complete every AP EAMCET slot', () => {
  test('a reply that fills the LAST missing AP EAMCET slot (gender) AND makes the profile OC+male must return the blocked-case response, never "ready to predict"', () => {
    const almostCompleteBlockedProfile = { examType: EXAM_AP, rank: 45000, category: 'OC', region: 'AU' };
    const ctx = {
      flowV2: {
        stage: R4P_SLOT_STAGE,
        r4pPendingSlot: 'gender',
        profile: profileWith(almostCompleteBlockedProfile),
      },
    };
    const result = handleR4PReply(ctx, 'Male');

    assert.equal(result.contextPatch.stage, R4P_BLOCKED_STAGE);
    assert.notEqual(result.contextPatch.stage, R4P_AWAITING_PREDICTION_STAGE);
    assert.equal(result.interactive.body, BLOCKED_REPLY_TEXT);
    assert.deepEqual(
      result.interactive.buttons.map((b) => b.title),
      ['Connect me', 'What should I look for meanwhile?']
    );
    // The facts that made it blocked are still on the profile handed back
    // \u2014 additive merge, same guarantee as every other beat.
    assert.equal(result.contextPatch.profile.gender, 'male');
    assert.equal(result.contextPatch.profile.category, 'OC');
  });

  test('a single message that both fills every remaining AP EAMCET slot (category+gender in one shot) AND matches OC+Male is caught the SAME way, proving this does not depend on gender specifically being the last slot asked', () => {
    const ctx = {
      flowV2: {
        stage: R4P_SLOT_STAGE,
        r4pPendingSlot: 'category',
        profile: profileWith({ examType: EXAM_AP, rank: 45000, region: 'AU' }),
      },
    };
    const result = handleR4PReply(ctx, 'OC Male');
    assert.equal(result.contextPatch.stage, R4P_BLOCKED_STAGE);
    assert.equal(result.interactive.body, BLOCKED_REPLY_TEXT);
  });

  test('negative control \u2014 the exact same slot-completing shape for a NON-blocked combination (OC + female) correctly reaches "all slots known", proving the ordering test above is actually exercising the blocked path and not just always winning', () => {
    const ctx = {
      flowV2: {
        stage: R4P_SLOT_STAGE,
        r4pPendingSlot: 'gender',
        profile: profileWith({ examType: EXAM_AP, rank: 45000, category: 'OC', region: 'AU' }),
      },
    };
    const result = handleR4PReply(ctx, 'Female');
    assert.equal(result.contextPatch.stage, R4P_AWAITING_PREDICTION_STAGE);
    assert.equal(result.contextPatch.profile.gender, 'female');
  });
});

describe('R4-P \u2461 slot filling \u2014 multi-slot single message fills everything an exam needs in one pass, for at least two exams with different slot orders', () => {
  test('TS EAMCET: "TS EAMCET rank 18453 OC Male" fills exam+rank+category+gender in one reply and asks nothing further (TS needs no region)', () => {
    const entry = handleR4PEntry({ flowV2: { profile: emptyFlowV2Profile() } });
    assert.equal(entry.contextPatch.r4pPendingSlot, 'exam');

    const replyCtx = { flowV2: { stage: R4P_SLOT_STAGE, r4pPendingSlot: 'exam', profile: entry.contextPatch.profile } };
    const result = handleR4PReply(replyCtx, 'TS EAMCET rank 18453 OC Male');

    assert.equal(result.contextPatch.stage, R4P_AWAITING_PREDICTION_STAGE);
    assert.equal(result.interactive, null);
    assert.equal(result.replyText, null);
    const p = result.contextPatch.profile;
    assert.equal(p.examType, 'TS_EAMCET');
    assert.equal(p.rank, 18453);
    assert.equal(p.category, 'OC');
    assert.equal(p.gender, 'male');
  });

  test('JEE Main: "JEE Main AIR 5000 Male General" fills exam+rank+gender+category in one reply and asks nothing further', () => {
    const entry = handleR4PEntry({ flowV2: { profile: emptyFlowV2Profile() } });
    const replyCtx = { flowV2: { stage: R4P_SLOT_STAGE, r4pPendingSlot: 'exam', profile: entry.contextPatch.profile } };
    const result = handleR4PReply(replyCtx, 'JEE Main AIR 5000 Male General');

    assert.equal(result.contextPatch.stage, R4P_AWAITING_PREDICTION_STAGE);
    assert.equal(result.interactive, null);
    const p = result.contextPatch.profile;
    assert.equal(p.examType, 'JEE_MAIN');
    assert.equal(p.rank, 5000);
    assert.equal(p.gender, 'male');
    assert.equal(p.category, 'GENERAL');
  });
});

describe('R4-P \u2461 slot filling \u2014 never re-asks a known slot, proven across a multi-turn sequence', () => {
  test('turn 1 gives exam, turn 2 gives rank \u2014 turn 2\u2019s question is for the NEXT missing slot (category), not a re-ask of exam or rank', () => {
    const entry = handleR4PEntry({ flowV2: { profile: emptyFlowV2Profile() } });
    assert.equal(entry.contextPatch.r4pPendingSlot, 'exam');

    const turn2 = handleR4PReply(
      { flowV2: { stage: R4P_SLOT_STAGE, r4pPendingSlot: 'exam', profile: entry.contextPatch.profile } },
      'TS EAMCET'
    );
    assert.equal(turn2.contextPatch.r4pPendingSlot, 'rank');
    assert.equal(turn2.contextPatch.profile.examType, 'TS_EAMCET');

    const turn3 = handleR4PReply(
      { flowV2: { stage: R4P_SLOT_STAGE, r4pPendingSlot: 'rank', profile: turn2.contextPatch.profile } },
      'rank 18453'
    );
    assert.equal(turn3.contextPatch.r4pPendingSlot, 'category');
    assert.notEqual(turn3.contextPatch.r4pPendingSlot, 'exam');
    assert.notEqual(turn3.contextPatch.r4pPendingSlot, 'rank');
    // Earlier turns' facts survive \u2014 additive merge, not overwritten.
    assert.equal(turn3.contextPatch.profile.examType, 'TS_EAMCET');
    assert.equal(turn3.contextPatch.profile.rank, 18453);
  });
});

describe('R4-P \u2461 slot filling \u2014 exam-specific ordering actually branches on the exam (3 distinct exam types, 3 distinct next-slot outcomes)', () => {
  test('AP EAMCET with rank already known asks CATEGORY next (order: exam, rank, category, gender, region)', () => {
    const result = handleR4PEntry({ flowV2: { profile: profileWith({ examType: 'AP_EAMCET', rank: 12345 }) } });
    assert.equal(result.contextPatch.r4pPendingSlot, 'category');
    assert.equal(result.interactive.type, 'list');
    assert.equal(result.interactive.body, 'Which category?\nWhy I ask: category changes the cutoff you need to clear.');
  });

  test('JEE Main with rank already known asks GENDER next (order: exam, rank, gender, category \u2014 gender BEFORE category, unlike AP)', () => {
    const result = handleR4PEntry({ flowV2: { profile: profileWith({ examType: 'JEE_MAIN', rank: 12345 }) } });
    assert.equal(result.contextPatch.r4pPendingSlot, 'gender');
    assert.equal(result.interactive.type, 'button');
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), ['Male', 'Female']);
  });

  test('KCET with rank already known asks ADMISSION TYPE next (order: exam, rank, admission_type, category \u2014 a slot AP/JEE never ask at all)', () => {
    const result = handleR4PEntry({ flowV2: { profile: profileWith({ examType: 'KCET', rank: 12345 }) } });
    assert.equal(result.contextPatch.r4pPendingSlot, 'admission_type');
    assert.equal(result.interactive.type, 'button');
    assert.deepEqual(result.interactive.buttons.map((b) => b.title), ['General', 'HK']);
  });
});

describe('R4-P \u2461 slot filling \u2014 "all slots known" correctly transitions to the Stage-3 placeholder, without erroring or hanging', () => {
  test('TNEA (default order: exam, rank, category) with all three already known transitions cleanly, no question asked', () => {
    const profile = profileWith({ examType: 'TNEA', rank: 5000, category: 'SC' });
    let result;
    assert.doesNotThrow(() => {
      result = handleR4PEntry({ flowV2: { profile } });
    });
    assert.equal(result.contextPatch.stage, R4P_AWAITING_PREDICTION_STAGE);
    assert.equal(result.contextPatch.r4pPendingSlot, null);
    assert.equal(result.interactive, null);
    assert.equal(result.replyText, null);
    assert.equal(result.replyParts, null);
    assert.equal(getR4PMissingSlots(result.contextPatch.profile).length, 0);
  });

  test('MHT CET (percentile-based, needs admission_type before category) reaching completeness via handleR4PReply, not just handleR4PEntry', () => {
    const ctx = {
      flowV2: {
        stage: R4P_SLOT_STAGE,
        r4pPendingSlot: 'category',
        profile: profileWith({ examType: 'MHT_CET', percentile: 91.5, admissionType: 'STATE_LEVEL' }),
      },
    };
    const result = handleR4PReply(ctx, 'General');
    assert.equal(result.contextPatch.stage, R4P_AWAITING_PREDICTION_STAGE);
    assert.equal(result.contextPatch.profile.category, 'GENERAL');
  });
});

describe('R4-P \u2461 slot filling \u2014 the Stage-3 placeholder stage falls through to the dispatcher\u2019s safeFallbackReply cleanly, with ZERO changes to flowV2Dispatcher.js (Stage 3 does not exist yet)', () => {
  test('a neutral message sent while stage is r4p_awaiting_prediction produces the dispatcher\u2019s generic fallback, not an error and not an R4-P-shaped reply', async () => {
    const ctx = { flowV2: { stage: R4P_AWAITING_PREDICTION_STAGE, profile: emptyFlowV2Profile() } };
    const result = await processFlowV2Turn(ctx, 'ok');

    assert.equal(result.replyText, "Let's continue from where we left off.");
    assert.equal(result.interactive, null);
    assert.equal(result.nextState, 'career_counselling_flow_v2');
    assert.notEqual(result.replyText, BLOCKED_REPLY_TEXT);
  });
});

describe('R4-P \u2461 slot filling \u2014 supporting unit coverage', () => {
  test('resolveLegacyExam bridges Flow v2\u2019s canonical examType values to the OLD flow\u2019s own EXAM_* constants', () => {
    assert.equal(resolveLegacyExam('AP_EAMCET'), EXAM_AP);
    assert.equal(resolveLegacyExam('TS_EAMCET'), EXAM_TS);
    assert.equal(resolveLegacyExam('KCET'), EXAM_KCET);
    assert.equal(resolveLegacyExam('MHT_CET'), EXAM_MHT);
    assert.equal(resolveLegacyExam(null), null);
  });

  test('getR4PMissingSlots returns just ["exam"] when examType is not yet known, regardless of anything else already filled', () => {
    assert.deepEqual(getR4PMissingSlots(profileWith({ rank: 5000, category: 'OC' })), ['exam']);
  });

  test('extractR4PAdmissionTypeTap resolves KCET\u2019s "HK" / "General" and MHT-CET\u2019s three options, including the "other than home university" vs "home university" ambiguity', () => {
    assert.equal(extractR4PAdmissionTypeTap('HK', EXAM_KCET), 'HK');
    assert.equal(extractR4PAdmissionTypeTap('General', EXAM_KCET), 'GENERAL');
    assert.equal(extractR4PAdmissionTypeTap('State Level', EXAM_MHT), 'STATE_LEVEL');
    assert.equal(extractR4PAdmissionTypeTap('Home University', EXAM_MHT), 'HOME_UNIVERSITY');
    assert.equal(extractR4PAdmissionTypeTap('Other than Home University', EXAM_MHT), 'OTHER_THAN_HOME_UNIVERSITY');
    assert.equal(extractR4PAdmissionTypeTap('Other than Home', EXAM_MHT), 'OTHER_THAN_HOME_UNIVERSITY');
  });

  test('a KCET admission-type reply of "General" does not silently pre-fill category before category is actually asked', () => {
    const ctx = {
      flowV2: {
        stage: R4P_SLOT_STAGE,
        r4pPendingSlot: 'admission_type',
        profile: profileWith({ examType: 'KCET', rank: 5000 }),
      },
    };
    const result = handleR4PReply(ctx, 'General');
    assert.equal(result.contextPatch.profile.admissionType, 'GENERAL');
    assert.equal(result.contextPatch.profile.category, null);
    assert.equal(result.contextPatch.r4pPendingSlot, 'category');
  });
});
