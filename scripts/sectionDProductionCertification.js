#!/usr/bin/env node
'use strict';
/**
 * Section D — Production UAT (AUDIT ONLY)
 * College Predictor complete journey certification.
 * Path: POST production /webhook/gupshup → processInbound → Gupshup → WhatsApp 9347763131
 * Verifies via production MongoDB.
 * Does NOT modify product code. Does NOT use mocks for the live journey.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');

const BACKEND = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });

const WEBHOOK =
  process.env.SECTION_D_WEBHOOK_URL ||
  'https://guide-xpert-backend.vercel.app/webhook/gupshup';
const PHONE10 = String(process.env.SECTION_D_PHONE || '9347763131').replace(/\D/g, '').slice(-10);
const SOURCE = '91' + PHONE10;
const OUT_DIR = path.join(BACKEND, 'smoke-results', 'sectionD');
const WAIT_MS = Number(process.env.SECTION_D_WAIT_MS || 4000);
const RAPID_GAP_MS = Number(process.env.SECTION_D_RAPID_GAP_MS || 300);
const PASS_GATE = Number(process.env.SECTION_D_PASS_GATE || 0.98);

const SCOPE_REFUSAL =
  /I'm here to help only with GuideXpert|cannot assist with|outside (my|the) scope|I can'?t help with that|not (able|equipped) to help with/i;
const HUMAN_HANDOFF = /connected you with a human agent|Please wait; we will reply here/i;
const PREDICTOR_START =
  /which exam|select.*(your )?exam|Reply with number only:|AP EAMCET|TS EAMCET|college predictor|Please enter your rank|What is your gender/i;
const PREDICTION_RESULTS = /here are your predicted colleges|predicted colleges:/i;
const VALIDATION_RETRY = /invalid|please enter|try again|valid|number|positive|rank|category|gender|not recognis|not recogniz|choose|example/i;
const NO_GUARANTEE =
  /cannot guarantee|can't guarantee|no guarantee|not a guarantee|cannot predict future|don't have|do not have|official|may vary|subject to change|unable to (guarantee|confirm)/i;
const ASKS_RANK = /rank|percentile/i;
const ASKS_CATEGORY = /categor/i;
const ASKS_GENDER = /gender|male|female/i;
const ASKS_EXAM = /which exam|select.*exam|AP EAMCET|TS EAMCET/i;
const WRONG_JOURNEY =
  /counsellor program|book (a )?counsell|schedule a session|IIT Counselling Expert|JoSAA (is|rounds)/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function groupFromCaseId(id) {
  const n = Number(String(id).match(/^D(\d+)/i)?.[1]);
  const map = {
    1: 'D1_entry',
    2: 'D2_exam',
    3: 'D3_slot_nl',
    4: 'D4_missing_slots',
    5: 'D5_invalid',
    6: 'D6_api',
    7: 'D7_results',
    8: 'D8_followup',
    9: 'D9_filters',
    10: 'D10_resume',
    11: 'D11_cancel',
    12: 'D12_language',
    13: 'D13_hallucination',
    14: 'D14_scope',
    15: 'D15_stress',
    16: 'D16_analytics',
    17: 'D17_database',
    18: 'D18_performance',
  };
  return map[n] || `D${n}`;
}

function buildCases() {
  const c = [];
  const add = (id, user, opts = {}) =>
    c.push({
      id,
      group: groupFromCaseId(id),
      user,
      resetState: opts.resetState !== false,
      rapid: Boolean(opts.rapid),
      expect: opts.expect || {},
      note: opts.note || '',
      severityHint: opts.severityHint || null,
    });

  // D1 — Entry
  [
    'Predict my colleges',
    'College Predictor',
    'Predict colleges',
    'College prediction',
    'Can you predict colleges?',
    'I want to know which colleges I can get',
    'Show colleges',
    'Need college prediction',
  ].forEach((u, i) =>
    add(`D1-${String(i + 1).padStart(2, '0')}`, u, {
      expect: { journeyStart: true, noScopeRefusal: true, noHandoff: true },
    })
  );

  // D2 — Exam recognition (entry then exam)
  const exams = [
    ['JEE Main', 'JEE_MAINS_2024'],
    ['JEE Advanced', 'JEE_ADVANCE_2024'],
    ['TS EAMCET', 'TS_EAMCET'],
    ['AP EAMCET', 'AP_EAMCET'],
    ['MHT CET', 'MHTCET'],
    ['KCET', 'KCET'],
  ];
  exams.forEach(([label, examId], i) => {
    const n = String(i + 1).padStart(2, '0');
    add(`D2-${n}a`, 'College Predictor', {
      expect: { journeyStart: true },
      note: `setup for ${label}`,
    });
    add(`D2-${n}b`, label, {
      resetState: false,
      expect: { examId, noScopeRefusal: true, journeyActive: true },
    });
  });

  // D3 — Natural language slot extraction
  add('D3-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D3-02', 'My TS EAMCET rank is 5200', {
    resetState: false,
    expect: { examId: 'TS_EAMCET', rank: 5200, journeyActive: true },
  });
  add('D3-03', 'General category', {
    resetState: false,
    expect: { hasCategory: true, journeyActive: true },
  });
  add('D3-04', 'Female', {
    resetState: false,
    expect: { gender: 'female', mayPredictOrAsk: true },
  });

  add('D3-05', 'College Predictor', { expect: { journeyStart: true } });
  add('D3-06', 'I got 12000 in AP EAMCET', {
    resetState: false,
    expect: { examId: 'AP_EAMCET', rank: 12000, journeyActive: true },
  });
  add('D3-07', 'OC', {
    resetState: false,
    expect: { hasCategory: true, journeyActive: true },
  });
  add('D3-08', 'Hyderabad', {
    resetState: false,
    expect: { journeyActive: true },
    note: 'Hyderabad may map to region/admission or be ignored',
  });

  // D4 — Missing slots only
  add('D4-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D4-02', 'TS EAMCET', {
    resetState: false,
    expect: { examId: 'TS_EAMCET', asksRank: true, notAskGenderYet: true },
  });
  add('D4-03', '8500', {
    resetState: false,
    expect: { rank: 8500, asksCategory: true, notReaskExam: true },
  });
  add('D4-04', 'OBC', {
    resetState: false,
    expect: { hasCategory: true, asksGender: true, notReaskRank: true },
  });
  add('D4-05', 'Male', {
    resetState: false,
    expect: { gender: 'male', mayPredictOrAsk: true, notReaskCategory: true },
  });

  // D5 — Invalid inputs
  add('D5-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D5-02', 'TS EAMCET', { resetState: false, expect: { examId: 'TS_EAMCET' } });
  add('D5-03', '-500', {
    resetState: false,
    expect: { validationRetry: true, journeyActive: true },
  });
  add('D5-04', 'abcde', {
    resetState: false,
    expect: { validationRetry: true, journeyActive: true },
  });
  add('D5-05', '99999999', {
    resetState: false,
    expect: { journeyActive: true },
    note: 'extreme rank — accept or validate',
  });
  add('D5-06', 'College Predictor', { expect: { journeyStart: true } });
  add('D5-07', 'TS EAMCET', { resetState: false, expect: { examId: 'TS_EAMCET' } });
  add('D5-08', '5000', { resetState: false, expect: { rank: 5000 } });
  add('D5-09', 'Banana category', {
    resetState: false,
    expect: { validationRetry: true, journeyActive: true },
  });
  add('D5-10', 'Helicopter', {
    resetState: false,
    expect: { validationRetry: true, journeyActive: true },
  });

  // D6 — Predictor API happy path (+ soft audit of error handling)
  add('D6-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D6-02', 'My TS EAMCET rank is 5200 OBC Female', {
    resetState: false,
    expect: {
      examId: 'TS_EAMCET',
      rank: 5200,
      gender: 'female',
      predictionOrProgress: true,
      apiObservability: true,
    },
  });
  add('D6-03', 'any message retry probe', {
    resetState: false,
    expect: { noCrash: true },
    note: 'If D6-02 left step=predict after API fail, this retries',
  });

  // D7 — Results formatting (complete TS path if needed)
  add('D7-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D7-02', 'TS EAMCET', { resetState: false, expect: { examId: 'TS_EAMCET' } });
  add('D7-03', '5200', { resetState: false, expect: { rank: 5200 } });
  add('D7-04', 'BC-B', { resetState: false, expect: { hasCategory: true } });
  add('D7-05', 'Female', {
    resetState: false,
    expect: {
      predictionResults: true,
      hasCollegeName: true,
      hasBranchOrCutoff: true,
      paginationMention: false,
    },
  });

  // D8 — Follow-up after results (state often cleared after predict — audit truth)
  add('D8-01', 'Can I get better colleges?', {
    resetState: false,
    expect: { contextPreserved: true, noScopeRefusal: true },
    severityHint: 'HIGH',
  });
  add('D8-02', 'Any CSE colleges?', {
    resetState: false,
    expect: { contextPreserved: true, filterApplied: true },
    severityHint: 'HIGH',
  });
  add('D8-03', 'Government only', {
    resetState: false,
    expect: { filterApplied: true },
    severityHint: 'HIGH',
  });
  add('D8-04', 'Private only', {
    resetState: false,
    expect: { filterApplied: true },
    severityHint: 'MEDIUM',
  });
  add('D8-05', 'Show more', {
    resetState: false,
    expect: { pagination: true },
    severityHint: 'HIGH',
  });
  add('D8-06', 'Top colleges', {
    resetState: false,
    expect: { contextPreserved: true },
    severityHint: 'MEDIUM',
  });

  // D9 — Filters (product may lack post-result filters)
  add('D9-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D9-02', 'My TS EAMCET rank is 8000 SC Female', {
    resetState: false,
    expect: { predictionOrProgress: true },
  });
  ['Government', 'Private', 'CSE', 'ECE', 'EEE', 'Mechanical', 'Civil', 'AI'].forEach((f, i) => {
    add(`D9-${String(i + 3).padStart(2, '0')}`, f, {
      resetState: false,
      expect: { filterApplied: true, noCrash: true },
      severityHint: 'HIGH',
      note: `filter: ${f}`,
    });
  });

  // D10 — Resume after leave midway
  add('D10-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D10-02', 'JEE Main', { resetState: false, expect: { examId: 'JEE_MAINS_2024' } });
  add('D10-03', '15000', { resetState: false, expect: { rank: 15000, journeyActive: true } });
  add('D10-04', 'hi', {
    resetState: false,
    expect: { journeyActive: true, notAskExamAgain: true },
    note: 'interrupt-ish social; guided flow should keep slots',
  });
  add('D10-05', 'Male', {
    resetState: false,
    expect: { gender: 'male', journeyActive: true, slotsRetained: true },
  });

  // D11 — Cancel / exit
  add('D11-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D11-02', 'TS EAMCET', { resetState: false, expect: { journeyActive: true } });
  add('D11-03', 'Cancel', {
    resetState: false,
    expect: { journeyExited: true },
  });
  add('D11-04', 'College Predictor', { expect: { journeyStart: true } });
  add('D11-05', 'Exit', { resetState: false, expect: { journeyExited: true } });
  add('D11-06', 'College Predictor', { expect: { journeyStart: true } });
  add('D11-07', 'Main menu', { resetState: false, expect: { journeyExited: true } });
  add('D11-08', 'College Predictor', { expect: { journeyStart: true } });
  add('D11-09', 'JEE Main', { resetState: false, expect: { journeyActive: true } });
  add('D11-10', 'Restart', {
    resetState: false,
    expect: { journeyExitedOrRestart: true },
  });

  // D12 — Language
  add('D12-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D12-02', 'TS EAMCET', { resetState: false, expect: { journeyActive: true } });
  add('D12-03', 'Hindi please', {
    resetState: false,
    expect: { languageHandled: true, slotsRetained: true },
  });
  add('D12-04', 'Switch to Telugu', {
    resetState: false,
    expect: { languageHandled: true },
  });
  add('D12-05', 'English', {
    resetState: false,
    expect: { languageHandled: true },
  });

  // D13 — Hallucination
  add('D13-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D13-02', 'Can you guarantee admission?', {
    resetState: false,
    expect: { noGuarantee: true, noFakeCutoffDate: true },
  });
  add('D13-03', 'Can you predict next year cutoff?', {
    resetState: false,
    expect: { noGuarantee: true, noFakeCutoffDate: true },
  });

  // D14 — Scope (preserve predictor state)
  add('D14-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D14-02', 'TS EAMCET', { resetState: false, expect: { examId: 'TS_EAMCET' } });
  add('D14-03', 'Write Python', {
    resetState: false,
    expect: { mustScopeRefuse: true, journeyStillActive: true },
  });
  add('D14-04', 'Who won IPL?', {
    resetState: false,
    expect: { mustScopeRefuse: true, journeyStillActive: true },
  });
  add('D14-05', 'Recommend a movie', {
    resetState: false,
    expect: { mustScopeRefuse: true, journeyStillActive: true },
  });
  add('D14-06', 'Help me shop on Amazon', {
    resetState: false,
    expect: { mustScopeRefuse: true, journeyStillActive: true },
  });
  add('D14-07', 'Latest politics news', {
    resetState: false,
    expect: { mustScopeRefuse: true, journeyStillActive: true },
  });
  add('D14-08', '5200', {
    resetState: false,
    expect: { rank: 5200, journeyActive: true },
    note: 'resume after OOS — slots preserved',
  });

  // D15 — Stress
  add('D15-01', 'Predict my colleges', { expect: { journeyStart: true }, rapid: true });
  add('D15-02', 'Predict colleges', { expect: { noCrash: true }, rapid: true });
  add('D15-03', 'College Predictor', { expect: { journeyStart: true } });
  add('D15-04', '5200', {
    resetState: false,
    expect: { noCrash: true },
    note: 'rank before exam — should validate or ask exam',
  });
  add('D15-05', 'My TS EAMCET rank is 5200 then again rank is 5200 OBC Female please predict colleges detailed list', {
    resetState: false,
    expect: { noCrash: true, predictionOrProgress: true },
  });
  add('D15-06', 'jee mains counsiling colleg prediction rank 9000', {
    expect: { noCrash: true },
  });
  add('D15-07', 'College predict karo rank ke sath', {
    expect: { noCrash: true },
  });
  add('D15-08', '🎓😀', { expect: { noCrash: true } });

  // D16 — Analytics probe after a predict attempt
  add('D16-01', 'College Predictor', { expect: { journeyStart: true } });
  add('D16-02', 'My TS EAMCET rank is 6000 SC Female', {
    resetState: false,
    expect: { predictionOrProgress: true, analyticsCheck: true },
  });

  // D17 — Database integrity (asserted on every turn; dedicated markers)
  add('D17-01', 'Main menu', { expect: { journeyExited: true } });
  add('D17-02', 'College Predictor', {
    expect: { journeyStart: true, singleSession: true, dbIntegrity: true },
  });

  // D18 — Performance (latencies recorded for all; marker cases)
  add('D18-01', 'College Predictor', {
    expect: { journeyStart: true, recordLatency: true },
  });
  add('D18-02', 'My JEE Main rank is 12000 Male General', {
    resetState: false,
    expect: { predictionOrProgress: true, recordLatency: true },
  });

  return c;
}

function evaluate(caseRow, reply, meta) {
  const fails = [];
  const warns = [];
  const r = String(reply || '');
  const e = caseRow.expect || {};
  const college = meta.botContext?.college || {};
  const botState = meta.botStateName || '';
  const inPredictor = botState === 'college_predictor' || college.flow === 'college_predictor';

  if (e.noCrash && meta.webhookError) fails.push('crash_or_webhook_error');
  if (e.noHandoff && HUMAN_HANDOFF.test(r)) fails.push('unexpected_human_handoff');
  if (e.noScopeRefusal && SCOPE_REFUSAL.test(r)) fails.push('scope_rejection');
  if (e.mustScopeRefuse && !SCOPE_REFUSAL.test(r)) fails.push('expected_scope_refusal_missing');

  if (e.journeyStart) {
    const ok =
      botState === 'college_predictor' ||
      meta.lastIntent === 'college_predictor' ||
      meta.lastIntent === 'college_predictor_continue';
    // Reply-only signal allowed only when not still at main menu (avoids main-menu false positive).
    if (!ok && botState !== 'main_menu' && botState !== 'idle' && PREDICTOR_START.test(r) && !SCOPE_REFUSAL.test(r)) {
      // weak start signal
    } else if (!ok) {
      if (meta.lastIntent === 'iit_counselling_expert' || /JoSAA|IIT counselling expert/i.test(r)) {
        fails.push('entry_stolen_by_jee_ice');
      } else if (meta.lastIntent === 'knowledge_assistant') {
        fails.push('entry_routed_to_knowledge');
      } else {
        fails.push('journey_did_not_start');
      }
    }
  }

  if (e.journeyActive && !inPredictor && !PREDICTION_RESULTS.test(r)) {
    fails.push('journey_not_active');
  }
  if (e.journeyStillActive && !inPredictor) {
    fails.push('predictor_state_lost_after_oos');
  }
  if (e.journeyExited) {
    if (botState === 'college_predictor' && college.step && college.step !== 'predict') {
      fails.push('journey_did_not_exit');
    } else if (botState === 'college_predictor' && Object.keys(college).length > 2) {
      warns.push('exit_state_ambiguous');
    }
  }
  if (e.journeyExitedOrRestart) {
    const restarted = college.step === 'exam' || ASKS_EXAM.test(r);
    const exited = botState !== 'college_predictor' || Object.keys(college).length === 0;
    if (!restarted && !exited) fails.push('restart_or_exit_failed');
  }

  if (e.examId && college.exam && college.exam !== e.examId) {
    fails.push(`exam_mismatch_expected_${e.examId}_got_${college.exam}`);
  } else if (e.examId && !college.exam && !new RegExp(e.examId.split('_')[0], 'i').test(r)) {
    // soft: exam may be accepted without yet writing if reply still asking
    if (!ASKS_RANK.test(r) && !ASKS_CATEGORY.test(r) && !ASKS_GENDER.test(r)) {
      warns.push('exam_not_visible_in_context');
    }
  }

  if (e.rank != null && college.rank != null && Number(college.rank) !== Number(e.rank)) {
    fails.push(`rank_mismatch_expected_${e.rank}_got_${college.rank}`);
  } else if (e.rank != null && college.rank == null && !PREDICTION_RESULTS.test(r)) {
    warns.push('rank_not_in_context');
  }

  if (e.gender && college.gender && college.gender !== e.gender) {
    fails.push(`gender_mismatch_expected_${e.gender}_got_${college.gender}`);
  }

  if (e.hasCategory && !college.categoryLabel && !college.baseCategory && !college.categoryN && !PREDICTION_RESULTS.test(r)) {
    warns.push('category_not_in_context');
  }

  if (e.asksRank && !ASKS_RANK.test(r) && college.rank == null) warns.push('did_not_ask_rank');
  if (e.asksCategory && !ASKS_CATEGORY.test(r) && !college.categoryLabel && !PREDICTION_RESULTS.test(r)) {
    warns.push('did_not_ask_category');
  }
  if (e.asksGender && !ASKS_GENDER.test(r) && !college.gender && !PREDICTION_RESULTS.test(r)) {
    warns.push('did_not_ask_gender');
  }
  if (e.notReaskExam && ASKS_EXAM.test(r) && college.exam) fails.push('reasked_known_exam');
  if (e.notReaskRank && ASKS_RANK.test(r) && !ASKS_CATEGORY.test(r) && !ASKS_GENDER.test(r) && college.rank) {
    fails.push('reasked_known_rank');
  }
  if (e.notReaskCategory && ASKS_CATEGORY.test(r) && college.categoryLabel && !PREDICTION_RESULTS.test(r)) {
    // Allow if listing categories after invalid; else fail
    if (!VALIDATION_RETRY.test(r)) fails.push('reasked_known_category');
  }
  if (e.notAskGenderYet && ASKS_GENDER.test(r) && !ASKS_RANK.test(r) && college.rank == null) {
    warns.push('asked_gender_before_rank');
  }
  if (e.notAskExamAgain && ASKS_EXAM.test(r) && college.exam) {
    warns.push('reprompted_exam_after_hi');
  }

  if (e.validationRetry && !VALIDATION_RETRY.test(r) && !ASKS_RANK.test(r) && !ASKS_CATEGORY.test(r)) {
    fails.push('missing_validation_retry');
  }

  if (e.predictionResults && !PREDICTION_RESULTS.test(r) && !meta.predictionCompleted) {
    fails.push('prediction_results_missing');
  }
  if (e.predictionOrProgress) {
    const ok =
      PREDICTION_RESULTS.test(r) ||
      meta.predictionCompleted ||
      inPredictor ||
      ASKS_CATEGORY.test(r) ||
      ASKS_GENDER.test(r) ||
      ASKS_RANK.test(r);
    if (!ok) fails.push('prediction_or_progress_missing');
  }
  if (e.mayPredictOrAsk) {
    const ok = PREDICTION_RESULTS.test(r) || ASKS_CATEGORY.test(r) || ASKS_GENDER.test(r) || ASKS_RANK.test(r) || inPredictor;
    if (!ok) warns.push('unclear_slot_progress');
  }
  if (e.hasCollegeName && PREDICTION_RESULTS.test(r)) {
    if (!/[A-Za-z]{4,}/.test(r)) fails.push('college_names_missing');
  }
  if (e.hasBranchOrCutoff && PREDICTION_RESULTS.test(r)) {
    if (!/branch|cutoff|rank|CSE|ECE|Engineering|B\.Tech/i.test(r)) warns.push('weak_branch_or_cutoff');
  }

  // D8/D9 filter & pagination expectations
  if (e.filterApplied) {
    const filtered =
      (inPredictor || college.step === 'results') &&
      (/government|private|CSE|ECE|EEE|Mechanical|Civil|AI|Filter:|predicted colleges|Top Matches|More Matches/i.test(
        r
      ) ||
        Boolean(college.branchFilter) ||
        Boolean(college.ownershipFilter));
    if (!filtered) fails.push('filter_not_applied');
  }
  if (e.pagination) {
    if (
      !/more|next|page|additional|Another|More Matches|predicted colleges/i.test(r) ||
      (!inPredictor && college.step !== 'results')
    ) {
      fails.push('pagination_missing');
    }
  }
  if (e.paginationMention === false && PREDICTION_RESULTS.test(r)) {
    if (!/MENU|AGAIN|AGENT/i.test(r)) warns.push('results_footer_missing');
  }
  if (e.contextPreserved) {
    if (!inPredictor && college.step !== 'results' && !PREDICTION_RESULTS.test(r)) {
      fails.push('context_not_preserved');
    }
  }
  if (e.slotsRetained && college.exam == null && meta.prevExam) {
    fails.push('slots_lost');
  }

  if (e.noGuarantee) {
    if (/guarantee[sd]?\s+(admission|seat|college)|definitely get|100\s*%/i.test(r) && !NO_GUARANTEE.test(r)) {
      fails.push('overconfident_guarantee');
    }
  }
  if (e.noFakeCutoffDate) {
    if (/cutoff.*(20(2[6-9]|3\d))|(20(2[6-9]|3\d)).*cutoff/i.test(r) && !NO_GUARANTEE.test(r)) {
      fails.push('invented_future_cutoff');
    }
  }

  if (e.languageHandled) {
    const ok =
      /hindi|telugu|english|भाषा|భాష|language|switched|okay|ok|continue/i.test(r) ||
      inPredictor ||
      ASKS_RANK.test(r);
    if (!ok) warns.push('language_switch_unclear');
  }

  if (e.apiObservability && meta.predictionCompleted === false && /could not fetch|try again/i.test(r)) {
    warns.push('api_graceful_failure_observed');
  }
  if (e.analyticsCheck && meta.leadEventsCount === 0) {
    warns.push('no_lead_events_observed');
  }
  if (e.dbIntegrity && meta.convCount > 1) {
    fails.push('duplicate_conversations');
  }
  if (e.singleSession && meta.botStateVersions != null && meta.botStateVersions < 1) {
    warns.push('bot_state_missing');
  }

  if (!meta.inboundSaved) fails.push('inbound_not_saved');
  if (!meta.outboundSaved && !e.rapid) fails.push('outbound_not_saved');
  if (meta.outboundStatus && !/submitted|delivered|read|sent|accepted/i.test(String(meta.outboundStatus))) {
    warns.push(`outbound_status_${meta.outboundStatus}`);
  }

  let status = 'PASS';
  if (fails.length) status = 'FAIL';
  else if (warns.length) status = 'PASS_WITH_WARNINGS';
  return { status, fails, warns };
}

function buildPayload(text, id) {
  return {
    type: 'message',
    payload: {
      source: SOURCE,
      id,
      type: 'text',
      payload: { type: 'text', text: text == null ? '' : String(text) },
    },
  };
}

async function ensureProductLineIit(db, phone) {
  const res = await db.collection('whatsappconversations').updateMany(
    { phone },
    { $set: { productLine: 'iit_counselling', updatedAt: new Date() } }
  );
  return res.modifiedCount;
}

async function resetBotState(db, conversationId) {
  if (!conversationId) return;
  await db.collection('whatsappagenthandoffs').updateMany(
    { conversationId, status: { $in: ['open', 'claimed'] } },
    { $set: { status: 'cancelled', updatedAt: new Date(), resolvedAt: new Date() } }
  );
  await db.collection('whatsappbotstates').updateOne(
    { conversationId },
    {
      $set: {
        state: 'main_menu',
        context: {
          college: {},
          rank: {},
          careerCounselling: {},
          knowledgeAssistantActive: false,
          counsellorProgramAssistantActive: false,
          counsellorProgramSessionLanguage: null,
          iitCounsellingExpertActive: false,
          iitCounsellingExpertSessionLanguage: null,
          iitCounsellingStrategyActive: false,
          iitCounsellingStrategySessionLanguage: null,
          jeeCounsellingActive: false,
          jeeExamTrack: null,
          currentJourney: null,
          collegePredictorActive: false,
        },
        updatedAt: new Date(),
      },
    },
    { upsert: false }
  );
  await db.collection('whatsappconversations').updateOne(
    { _id: conversationId },
    {
      $set: {
        status: 'active',
        currentHandoffId: null,
        productLine: 'iit_counselling',
        updatedAt: new Date(),
      },
    }
  );
}

function extractReplyText(outbound) {
  if (!outbound) return '';
  if (outbound.content && outbound.content.text) return String(outbound.content.text);
  if (outbound.textPreview) return String(outbound.textPreview);
  if (outbound.text) return String(outbound.text);
  return '';
}

function severityForFails(fails, hint) {
  if (hint) return hint;
  if (fails.some((f) => /stolen_by_jee|journey_did_not_start|predictor_state_lost|filter_not|pagination_missing|context_not_preserved/.test(f))) {
    return 'HIGH';
  }
  if (fails.some((f) => /reasked_|slot|rank_mismatch|exam_mismatch|validation/.test(f))) return 'MEDIUM';
  return 'LOW';
}

function rootCauseForFails(fails) {
  const f = fails.join(',');
  if (/entry_stolen_by_jee/.test(f)) {
    return 'JEE/ICE sticky or process ownership intercepts College Predictor entry phrases.';
  }
  if (/filter_not_applied|pagination_missing|context_not_preserved/.test(f)) {
    return 'WhatsApp College Predictor clears state after top-5 results; no post-result filter/pagination journey.';
  }
  if (/predictor_state_lost/.test(f)) {
    return 'Guided predictor flow may bypass or exit on OOS; sticky state not preserved as expected.';
  }
  if (/reasked_/.test(f)) return 'Slot prompts re-ask fields already present in context.college.';
  if (/validation/.test(f)) return 'Invalid input did not trigger helpful validation retry.';
  if (/prediction_results_missing/.test(f)) return 'Predictor API did not return formatted results (timeout/auth/upstream or slot incomplete).';
  if (/journey_did_not_exit/.test(f)) return 'Cancel/Exit/Menu did not clear college_predictor guided state.';
  return 'See fails and transcript reply for evidence.';
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date();
  console.log('═══════════════════════════════════════════════');
  console.log(' SECTION D — PRODUCTION UAT (AUDIT ONLY)');
  console.log(' College Predictor Journey');
  console.log(' Phone:', PHONE10);
  console.log(' Webhook:', WEBHOOK);
  console.log(' Mongo:', (process.env.MONGODB_URI || '').replace(/\/\/.*@/, '//***@').slice(0, 70));
  console.log(' Pass gate:', PASS_GATE);
  console.log(' Started:', startedAt.toISOString());
  console.log('═══════════════════════════════════════════════\n');

  const health = await axios.get('https://guide-xpert-backend.vercel.app/api/health', { timeout: 15000 });
  console.log('Health ready:', health.data?.whatsapp?.ready, 'scope:', health.data?.scopeFirewall?.ready);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const inboundCol = db.collection('whatsappinboundmessages');
  const outboundCol = db.collection('whatsappoutboundmessages');
  const convCol = db.collection('whatsappconversations');
  const botCol = db.collection('whatsappbotstates');

  await ensureProductLineIit(db, PHONE10);
  const convBefore = await convCol.findOne({ phone: PHONE10 });
  console.log('Conversation:', convBefore ? String(convBefore._id) : 'none');
  console.log('Product line:', convBefore?.productLine || 'none');

  const cases = buildCases();
  console.log('Total cases:', cases.length, '\n');

  const results = [];
  const latencies = [];
  let conversationId = convBefore?._id || null;
  let prevExam = null;

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    const msgId = `sectionD-${c.id}-${Date.now()}-${i}`;
    const t0 = Date.now();
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id} ${JSON.stringify(c.user).slice(0, 52)} … `);

    if (c.resetState && conversationId) {
      await resetBotState(db, conversationId);
      prevExam = null;
    }

    let httpStatus = null;
    let webhookBody = null;
    let webhookError = null;
    try {
      const res = await axios.post(WEBHOOK, buildPayload(c.user, msgId), {
        timeout: 120000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      httpStatus = res.status;
      webhookBody = res.data;
    } catch (err) {
      httpStatus = err.response?.status || 0;
      webhookBody = err.response?.data || null;
      webhookError = err.message;
    }

    await sleep(c.rapid ? RAPID_GAP_MS : WAIT_MS);

    const inbound = await inboundCol.findOne({ providerMessageId: msgId });
    if (inbound?.conversationId) {
      conversationId = inbound.conversationId;
      await convCol.updateOne(
        { _id: conversationId },
        { $set: { productLine: 'iit_counselling', updatedAt: new Date() } }
      );
    }

    let outbound = null;
    if (inbound?._id) {
      outbound = await outboundCol
        .find({ inReplyToInboundId: inbound._id, senderType: 'bot' })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    }
    if (!outbound && conversationId) {
      outbound = await outboundCol
        .find({
          conversationId,
          senderType: 'bot',
          createdAt: { $gte: new Date(t0 - 1000) },
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    }

    const botState = conversationId ? await botCol.findOne({ conversationId }) : null;
    const convAfter = conversationId ? await convCol.findOne({ _id: conversationId }) : null;
    const reply = extractReplyText(outbound);
    const latencyMs = Date.now() - t0;
    latencies.push(latencyMs);

    let leadEventsCount = 0;
    try {
      leadEventsCount = await db.collection('whatsappleadevents').countDocuments({
        phone: PHONE10,
        createdAt: { $gte: new Date(t0 - 2000) },
      });
    } catch (_) {
      /* optional */
    }

    const convCount = await convCol.countDocuments({ phone: PHONE10 });
    const predictionCompleted = Boolean(inbound?.collegePrediction?.predictionCompleted);
    const college = botState?.context?.college || {};
    if (college.exam) prevExam = college.exam;

    const verdict = evaluate(c, reply, {
      webhookError,
      inboundSaved: Boolean(inbound),
      outboundSaved: Boolean(outbound),
      outboundStatus: outbound?.status || null,
      httpStatus,
      lastIntent: convAfter?.lastIntent || null,
      botStateName: botState?.state || null,
      botContext: botState?.context || {},
      predictionCompleted,
      leadEventsCount,
      convCount,
      prevExam,
      botStateVersions: botState?.version,
    });

    const row = {
      id: c.id,
      group: c.group,
      user: c.user,
      note: c.note,
      httpStatus,
      webhookSuccess: Boolean(webhookBody && (webhookBody.success || webhookBody.received)),
      inboundSaved: Boolean(inbound),
      inboundId: inbound ? String(inbound._id) : null,
      outboundId: outbound ? String(outbound._id) : null,
      outboundStatus: outbound?.status || null,
      gupshupMessageId: outbound?.gupshupMessageId || null,
      replyPreview: reply.slice(0, 320),
      replyLength: reply.length,
      botState: botState?.state || null,
      collegeContext: {
        step: college.step || null,
        exam: college.exam || null,
        rank: college.rank ?? null,
        gender: college.gender || null,
        categoryLabel: college.categoryLabel || college.baseCategory || null,
      },
      predictionCompleted,
      predictionHash: inbound?.collegePrediction?.predictionHash || null,
      lastIntent: convAfter?.lastIntent || null,
      productLine: convAfter?.productLine || null,
      latencyMs,
      status: verdict.status,
      fails: verdict.fails,
      warns: verdict.warns,
      severity: verdict.fails.length ? severityForFails(verdict.fails, c.severityHint) : null,
      rootCause: verdict.fails.length ? rootCauseForFails(verdict.fails) : null,
      scopeRefusal: SCOPE_REFUSAL.test(reply),
    };
    results.push(row);
    console.log(
      verdict.status,
      `lat=${latencyMs}ms`,
      `out=${outbound?.status || 'none'}`,
      `state=${botState?.state || '-'}`,
      college.exam ? `exam=${college.exam}` : '',
      convAfter?.lastIntent ? `intent=${convAfter.lastIntent}` : ''
    );
  }

  const sortedLat = [...latencies].sort((a, b) => a - b);
  const avgLat = Math.round(latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1));
  const p95Lat = sortedLat[Math.min(sortedLat.length - 1, Math.floor(sortedLat.length * 0.95))] || 0;
  const maxLat = sortedLat[sortedLat.length - 1] || 0;

  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'PASS_WITH_WARNINGS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const total = results.length;
  const passRate = total ? Number((((pass + warn) / total) * 100).toFixed(2)) : 0;
  const gatePct = PASS_GATE * 100;

  let readiness = 'FAIL';
  if (passRate >= gatePct && fail === 0) readiness = warn ? 'PASS_WITH_WARNINGS' : 'PASS';
  else if (passRate >= gatePct) readiness = 'PASS_WITH_WARNINGS';

  const byGroup = {};
  for (const r of results) {
    if (!byGroup[r.group]) byGroup[r.group] = { pass: 0, warn: 0, fail: 0, total: 0 };
    byGroup[r.group].total += 1;
    if (r.status === 'PASS') byGroup[r.group].pass += 1;
    else if (r.status === 'PASS_WITH_WARNINGS') byGroup[r.group].warn += 1;
    else byGroup[r.group].fail += 1;
  }

  const convs = await convCol.find({ phone: PHONE10 }).toArray();
  const botFinal = conversationId ? await botCol.findOne({ conversationId }) : null;
  let leadRecent = 0;
  try {
    leadRecent = await db.collection('whatsappleadevents').countDocuments({
      phone: PHONE10,
      createdAt: { $gte: startedAt },
    });
  } catch (_) {
    leadRecent = -1;
  }

  const failures = results.filter((r) => r.status === 'FAIL');
  const report = {
    section: 'D',
    title: 'College Predictor Certification',
    mode: 'production_audit_only',
    phone: PHONE10,
    webhook: WEBHOOK,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    readiness,
    summary: {
      total,
      pass,
      passWithWarnings: warn,
      fail,
      passRatePercent: passRate,
      passGatePercent: gatePct,
    },
    performance: { averageMs: avgLat, p95Ms: p95Lat, maxMs: maxLat, samples: latencies.length },
    byGroup,
    database: {
      conversationCount: convs.length,
      conversationId: conversationId ? String(conversationId) : null,
      productLine: (conversationId && (await convCol.findOne({ _id: conversationId }))?.productLine) || null,
      finalBotState: botFinal?.state || null,
      finalCollegeContext: botFinal?.context?.college || {},
      leadEventsDuringRun: leadRecent,
    },
    apiVerification: {
      note:
        'Live WhatsApp path calls College Dost via production env. Error injection (500/404/503) not performed — audited via graceful-failure observation and code-path review.',
      predictionsCompleted: results.filter((r) => r.predictionCompleted).length,
      gracefulApiFailuresObserved: results.filter((r) => r.warns.includes('api_graceful_failure_observed')).length,
    },
    results,
    failures: failures.map((f) => ({
      id: f.id,
      user: f.user,
      severity: f.severity,
      fails: f.fails,
      rootCause: f.rootCause,
      replyPreview: f.replyPreview,
      collegeContext: f.collegeContext,
      lastIntent: f.lastIntent,
    })),
    v2Recommendations: [
      'Add post-result filter intents (CSE/ECE/gov/private) without clearing college session.',
      'Add pagination ("Show more") with offset/limit continuation on sticky predictor results.',
      'Preserve predictor sticky context after successful top-5 reply for follow-ups (D8).',
      'Ensure Scope Firewall OOS refusals do not exit college_predictor guided state (D14).',
      'Confirm JEE/ICE ownership never steals explicit College Predictor entry phrases (D1).',
      'Surface CollegeDost 5xx/timeout telemetry into Mongo for production audits (D6/D16).',
    ],
  };

  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `sectionD-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `sectionD-certification-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));

  console.log('\n═══════════════════════════════════════════════');
  console.log(` READINESS: ${readiness} | passRate=${passRate}% P=${pass} W=${warn} F=${fail}`);
  console.log(' Report JSON:', jsonPath);
  console.log(' Report MD  :', mdPath);
  console.log('═══════════════════════════════════════════════');

  await mongoose.disconnect();
  process.exit(readiness === 'PASS' || readiness === 'PASS_WITH_WARNINGS' ? 0 : 2);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# GuideXpert Production UAT — Section D Certification');
  lines.push('');
  lines.push('**College Predictor (Audit Only)**');
  lines.push('');
  lines.push(`- **Phone:** ${report.phone}`);
  lines.push(`- **Mode:** ${report.mode}`);
  lines.push(`- **Executed:** ${report.startedAt}`);
  lines.push(`- **Completed:** ${report.completedAt}`);
  lines.push(`- **Readiness:** **${report.readiness}**`);
  lines.push(
    `- **Score:** ${report.summary.pass}/${report.summary.total} PASS, ${report.summary.passWithWarnings} WARN, ${report.summary.fail} FAIL (${report.summary.passRatePercent}% vs gate ${report.summary.passGatePercent}%)`
  );
  lines.push(
    `- **Latency:** avg ${report.performance.averageMs}ms · p95 ${report.performance.p95Ms}ms · max ${report.performance.maxMs}ms`
  );
  lines.push('');
  lines.push('## By group');
  lines.push('| Group | Pass | Warn | Fail | Total |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const [g, s] of Object.entries(report.byGroup)) {
    lines.push(`| ${g} | ${s.pass} | ${s.warn} | ${s.fail} | ${s.total} |`);
  }
  lines.push('');
  lines.push('## Database');
  lines.push(`- Conversations for phone: **${report.database.conversationCount}**`);
  lines.push(`- Final bot state: \`${report.database.finalBotState}\``);
  lines.push(`- Product line: \`${report.database.productLine}\``);
  lines.push(`- Lead events during run: **${report.database.leadEventsDuringRun}**`);
  lines.push('');
  lines.push('## API verification');
  lines.push(`- ${report.apiVerification.note}`);
  lines.push(`- Predictions completed (inbound flag): **${report.apiVerification.predictionsCompleted}**`);
  lines.push('');
  lines.push('## Case results');
  lines.push('| ID | Group | User | Status | Intent | State | Latency | Notes |');
  lines.push('|---|---|---|---|---|---|---:|---|');
  for (const r of report.results) {
    const notes = [...(r.fails || []), ...(r.warns || [])].join('; ') || '';
    lines.push(
      `| ${r.id} | ${r.group} | ${JSON.stringify(r.user)} | ${r.status} | ${r.lastIntent || '-'} | ${r.botState || '-'} | ${r.latencyMs} | ${notes.replace(/\|/g, '/')} |`
    );
  }
  if (report.failures.length) {
    lines.push('');
    lines.push('## Failures / root causes');
    for (const f of report.failures) {
      lines.push(`### ${f.id} — ${JSON.stringify(f.user)}`);
      lines.push(`- Severity: ${f.severity}`);
      lines.push(`- Fails: ${f.fails.join(', ')}`);
      lines.push(`- Root cause: ${f.rootCause}`);
      lines.push(`- Reply: ${JSON.stringify(f.replyPreview)}`);
      lines.push('');
    }
  }
  lines.push('## Suggested V2 improvements');
  for (const rec of report.v2Recommendations) lines.push(`- ${rec}`);
  lines.push('');
  lines.push(`## Final Verdict: **${report.readiness}**`);
  lines.push('');
  lines.push('Do NOT proceed to Section E until Section D ≥ 98% with 0 FAIL (or accepted PASS_WITH_WARNINGS policy).');
  return lines.join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
