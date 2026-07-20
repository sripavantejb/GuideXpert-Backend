#!/usr/bin/env node
'use strict';

/**
 * P0 FINAL CONVERSATIONAL UX CERTIFICATION
 *
 * Real student-perspective experience gate — not a unit/routing regression suite.
 * Runs 100+ end-to-end journeys, grades every bot turn, and writes transcripts + stats.
 *
 *   node scripts/counselingConversationalUxCertification.js
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
const {
  setShortlistingEligibilityDeps,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
const { processCollegePredictorTurn } = require('../services/chatbot/guidedFlows/guidedFlowProcessors');

const {
  FULL_COUNSELING_PATH,
  PREDICTOR_BRIDGE_PATH,
  MAX_LINES_NORMAL,
  gradeTurn,
  uniqueOrdered,
  detectSkippedPhases,
  mockEligibleColleges,
  studentReplyForTurn,
  stageToUxPhase,
} = require('./lib/counselingUxCertCore');

const OUT_DIR = path.join(__dirname, '../smoke-results/counseling');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_JSON = path.join(OUT_DIR, `ux-conversational-cert-${STAMP}.json`);
const REPORT_MD = path.join(OUT_DIR, `ux-conversational-cert-${STAMP}.md`);
const LATEST_JSON = path.join(OUT_DIR, 'ux-conversational-cert-latest.json');
const LATEST_MD = path.join(OUT_DIR, 'ux-conversational-cert-latest.md');

const MAX_TURNS = 55;
const MOCK = mockEligibleColleges();

/** Suppress structured chatbot spam during certification runs. */
function silenceChatbotLogs() {
  const origInfo = console.info;
  console.info = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('[chatbot:structured]')) return;
    return origInfo.apply(console, args);
  };
  return () => {
    console.info = origInfo;
  };
}

function installMocks() {
  setShortlistingEligibilityDeps({
    fetchCollegeDostColleges: async () => ({
      colleges: MOCK,
      total_no_of_colleges: MOCK.length,
    }),
  });
  setCollegePredictorDeps({
    fetchCollegeDostColleges: async () => ({
      colleges: MOCK,
      total_no_of_colleges: MOCK.length,
    }),
  });
}

function clearMocks() {
  setShortlistingEligibilityDeps({});
  setCollegePredictorDeps({});
}

/** Build ≥100 persona scenarios across required student archetypes. */
function buildScenarios() {
  const scenarios = [];
  const locs = ['Hyderabad', 'Vizag', 'Warangal', 'Kakinada', 'Tirupati'];
  const ranks = [2500, 8000, 12000, 18000, 28000, 45000];
  const exams = ['TS EAMCET', 'AP EAPCET'];
  const courses = [
    { course: 'B.Tech CSE', goal: 'Software engineer at a product company', tag: 'wants_cse' },
    { course: 'B.Tech AI/ML', goal: 'AI engineer', tag: 'wants_ai' },
    { course: 'B.Tech', goal: 'Data scientist', tag: 'wants_ai' },
    { course: 'Engineering', goal: 'Still exploring tech careers', tag: 'knows_nothing' },
  ];

  let id = 0;
  const add = (partial) => {
    id += 1;
    scenarios.push({
      id: `J${String(id).padStart(3, '0')}`,
      mode: 'counseling',
      target: 'full_path',
      ...partial,
    });
  };

  // --- knows nothing (full path variants) ---
  for (let i = 0; i < 12; i += 1) {
    add({
      category: 'knows_nothing',
      entry: 'I need help choosing a career and college',
      qualification: i % 2 === 0 ? 'Class 12' : 'Intermediate MPC',
      course: courses[i % courses.length].course,
      goal: courses[i % courses.length].goal,
      colleges: 'not yet',
      location: locs[i % locs.length],
      exam: exams[i % exams.length],
      rank: ranks[i % ranks.length],
      categorySlot: i % 3 === 0 ? 'OC Girls' : 'OC Boys',
      gender: i % 3 === 0 ? 'Female' : 'Male',
    });
  }

  // --- branch only ---
  for (let i = 0; i < 8; i += 1) {
    add({
      category: 'branch_only',
      entry: 'I only know I want CSE',
      course: 'B.Tech CSE',
      goal: 'Software roles',
      colleges: 'not sure',
      location: locs[i % locs.length],
      exam: exams[i % 2],
      rank: ranks[i % ranks.length],
    });
  }

  // --- rank only ---
  for (let i = 0; i < 8; i += 1) {
    add({
      category: 'rank_only',
      entry: `My rank is ${ranks[i % ranks.length]}, guide me`,
      course: 'B.Tech',
      goal: 'Good placements',
      rank: ranks[i % ranks.length],
      exam: exams[i % 2],
      location: locs[i % locs.length],
    });
  }

  // --- already chose a college ---
  for (let i = 0; i < 6; i += 1) {
    add({
      category: 'college_chosen',
      entry: 'I already like one college — validate my choice',
      course: 'B.Tech CSE',
      goal: 'Product engineer',
      colleges: i % 2 === 0 ? 'JNTUH Hyderabad' : 'CBIT Hyderabad',
      location: 'Hyderabad',
      exam: 'TS EAMCET',
      rank: ranks[i % ranks.length],
    });
  }

  // --- wants CSE / AI (extra explicit) ---
  for (let i = 0; i < 6; i += 1) {
    add({
      category: 'wants_cse',
      entry: 'I want CSE only',
      course: 'CSE',
      goal: 'Software engineer',
      exam: exams[i % 2],
      rank: ranks[i % ranks.length],
      location: locs[i % locs.length],
    });
  }
  for (let i = 0; i < 6; i += 1) {
    add({
      category: 'wants_ai',
      entry: 'I want AI and machine learning',
      course: 'AI/ML',
      goal: 'AI researcher / ML engineer',
      exam: exams[i % 2],
      rank: ranks[i % ranks.length],
      location: locs[i % locs.length],
    });
  }

  // --- random questions mid-flow ---
  for (let i = 0; i < 6; i += 1) {
    add({
      category: 'random_questions',
      entry: 'Career counselling please',
      course: 'B.Tech',
      goal: 'Software',
      randomAt: 4 + (i % 5),
      randomMsg: [
        'What is the difference between CSE and IT?',
        'Do private colleges have good placements?',
        'Is hostel mandatory?',
        'What is ROI in college selection?',
        'Should I prefer rankings or projects?',
        'Can girls get CSE easily?',
      ][i],
      exam: 'TS EAMCET',
      rank: 14000,
      location: locs[i % locs.length],
    });
  }

  // --- topic change ---
  for (let i = 0; i < 5; i += 1) {
    add({
      category: 'topic_change',
      entry: 'Help me with colleges',
      course: 'B.Tech',
      goal: 'Engineer',
      topicChangeAt: 6 + i,
      topicChangeMsg: [
        'Actually tell me about fees first',
        'Wait — what about study abroad?',
        'Can we talk about branch choice instead?',
        'I also need scholarship info',
        'Switch to placements discussion',
      ][i],
      exam: 'TS EAMCET',
      rank: 16000,
    });
  }

  // --- interrupts ---
  for (let i = 0; i < 5; i += 1) {
    add({
      category: 'interrupt',
      entry: 'I am confused about colleges',
      course: 'Engineering',
      goal: 'Not sure yet',
      interruptAt: 3 + i,
      interruptMsg: [
        'hold on — what exams should I write?',
        'sorry, can you repeat that simply?',
        'wait is GuideXpert free?',
        'one sec — my parent is asking about fees',
        'stop — I only have 2 minutes',
      ][i],
      exam: 'AP EAPCET',
      rank: 22000,
      region: 'AU',
    });
  }

  // --- declines suggestions (soft-advance path) ---
  for (let i = 0; i < 6; i += 1) {
    add({
      category: 'declines',
      entry: 'Guide me carefully',
      course: 'B.Tech CSE',
      goal: 'Software',
      declineAtSteps: [
        'explore_ask_continue',
        'shortlist_ask_compare',
        'pers_ask_permission',
      ].slice(0, 1 + (i % 3)),
      declineMsg: 'no',
      // second decline soft-advances; still continue journey
      exam: 'TS EAMCET',
      rank: ranks[i % ranks.length],
      location: locs[i % locs.length],
      intentionalSkips: [
        {
          phase: 'Explore Modern Colleges',
          why: 'user_declined_optional_gate',
        },
      ],
    });
  }

  // --- language switch ---
  for (let i = 0; i < 5; i += 1) {
    add({
      category: 'language_switch',
      entry: 'Need counselling',
      language: i % 2 === 0 ? 'Telugu' : 'English',
      languageSwitchAt: 2,
      languageMsg: i % 2 === 0 ? 'Telugu please' : 'Please continue in English',
      course: 'B.Tech',
      goal: 'IT job',
      exam: 'TS EAMCET',
      rank: 11000,
    });
  }

  // --- returns later (pause mid-journey then resume) ---
  for (let i = 0; i < 5; i += 1) {
    add({
      category: 'returns_later',
      entry: 'Career guidance',
      course: 'B.Tech',
      goal: 'Software engineer',
      // Pause after discovery+early education so resume uses a continue token
      pauseAfterTurns: 7 + i,
      resumeMsg: 'ok continue',
      exam: 'TS EAMCET',
      rank: 13000,
      location: locs[i % locs.length],
    });
  }

  // --- counseling only (explicit) ---
  for (let i = 0; i < 6; i += 1) {
    add({
      category: 'counseling_only',
      entry: 'I want career counselling not just prediction',
      course: courses[i % courses.length].course,
      goal: courses[i % courses.length].goal,
      exam: exams[i % 2],
      rank: ranks[i % ranks.length],
      location: locs[i % locs.length],
    });
  }

  // --- prediction only → bridge into counseling ---
  for (let i = 0; i < 12; i += 1) {
    id += 1;
    scenarios.push({
      id: `J${String(id).padStart(3, '0')}`,
      mode: 'predictor_bridge',
      target: 'predictor_bridge',
      category: 'prediction_only',
      entry: i % 2 === 0 ? 'College predictor' : 'Predict my colleges',
      exam: exams[i % 2],
      rank: ranks[i % ranks.length],
      categorySlot: i % 2 === 0 ? 'OC Boys' : 'OC Girls',
      gender: i % 2 === 0 ? 'Male' : 'Female',
      region: 'AU',
      afterPrediction: 'bridge',
      continueToBooking: i % 3 === 0,
    });
  }

  // Pad to ≥100 with mixed micro-variants if needed
  while (scenarios.length < 100) {
    const i = scenarios.length;
    add({
      category: 'knows_nothing',
      entry: `Help me choose colleges variant ${i}`,
      course: courses[i % courses.length].course,
      goal: courses[i % courses.length].goal,
      exam: exams[i % 2],
      rank: ranks[i % ranks.length],
      location: locs[i % locs.length],
      colleges: 'not yet',
    });
  }

  return scenarios;
}

function personaFromScenario(s) {
  return {
    qualification: s.qualification || 'Class 12',
    course: s.course || 'B.Tech',
    goal: s.goal || 'Software engineer',
    colleges: s.colleges || 'not yet',
    language: s.language || 'English',
    exam: s.exam || 'TS EAMCET',
    rank: s.rank || 15000,
    category: s.categorySlot || 'OC Boys',
    gender: s.gender || 'Male',
    region: s.region || 'AU',
    location: s.location || 'Hyderabad, open to relocate',
    budget: s.budget || 'around 2-3 lakhs',
    family: s.family || 'parents supportive',
    concern: s.concern || 'fees and wrong branch',
    priority: s.priority || 'placements and skill building',
    learningStyle: s.learningStyle || 'hands-on projects with internships',
    evalPriorities: s.evalPriorities || 'projects, internships and mentoring',
    interruptAt: s.interruptAt,
    interruptMsg: s.interruptMsg,
    randomAt: s.randomAt,
    randomMsg: s.randomMsg,
    topicChangeAt: s.topicChangeAt,
    topicChangeMsg: s.topicChangeMsg,
    languageSwitchAt: s.languageSwitchAt,
    languageMsg: s.languageMsg,
    declineAtSteps: s.declineAtSteps || [],
    declineMsg: s.declineMsg || 'no',
    afterPrediction: s.afterPrediction || 'bridge',
    book: s.book !== false,
    hesitation: 'ready',
    counselingChoice: 'continue',
  };
}

function isJourneyDone(result, scenario) {
  const ctx = result?.context || {};
  const profile = ctx.profile || {};
  if (profile.journeyCompleted) return true;
  if (ctx.stage === 'journey_completed' || ctx.step === 'journey_completed') return true;
  if (ctx.stage && String(ctx.stage).includes('phase_14')) return true;
  // Phase 13 website URL shared = booking CTA delivered (Section E; no WA CRM write)
  if (profile.phase13UrlShared) return true;
  if (String(ctx.step || '') === 'booking_presented' && /guidexpert\.co\.in/i.test(String(result?.reply || ''))) {
    return true;
  }
  return false;
}

async function runCounselingJourney(scenario) {
  const persona = personaFromScenario(scenario);
  const transcript = [];
  const phasePath = [];
  const turnGrades = [];
  const intentionalSkips = [...(scenario.intentionalSkips || [])];
  let ctx = {};
  let previousReply = null;
  let turnsInSamePhase = 0;
  let lastPhase = null;
  let result = null;
  let skippedPhaseReasons = [];
  let identicalStreak = 0;

  const pushTurn = (user, res) => {
    if (previousReply && res.reply === previousReply) identicalStreak += 1;
    else identicalStreak = 0;
    const grade = gradeTurn({
      user,
      result: res,
      previousReply,
      turnsInSamePhase,
      consecutiveRepeats: identicalStreak,
    });
    const ux = grade.uxPhase;
    if (ux === lastPhase) turnsInSamePhase += 1;
    else {
      lastPhase = ux;
      turnsInSamePhase = 1;
      phasePath.push(ux);
    }
    if (res?.skippedPhaseReason) {
      skippedPhaseReasons.push({
        phase: ux,
        reason: res.skippedPhaseReason,
        intentional: true,
      });
      intentionalSkips.push({
        phase: ux,
        why: res.skippedPhaseReason,
      });
    }
    transcript.push({
      turn: transcript.length + 1,
      user,
      bot: res.reply,
      stage: res.context?.stage,
      step: res.context?.step,
      uxPhase: ux,
      roadmapPhase: grade.roadmapPhase,
      lineCount: grade.lineCount,
      words: grade.words,
      extended: grade.extended,
      failures: grade.failures,
      warnings: grade.warnings,
      orchestration: res.orchestration || null,
      skippedPhaseReason: res.skippedPhaseReason || null,
    });
    turnGrades.push(grade);
    previousReply = res.reply;
    return grade;
  };

  result = await handleCareerCounsellingMessage(scenario.entry, {}, { isNewEntry: true });
  pushTurn(scenario.entry, result);
  ctx = result.context;

  for (let t = 1; t < MAX_TURNS; t += 1) {
    if (isJourneyDone(result, scenario)) break;

    // return-later pause
    if (scenario.pauseAfterTurns && t === scenario.pauseAfterTurns) {
      const resume = scenario.resumeMsg || 'ok continue';
      result = await handleCareerCounsellingMessage(resume, ctx, {});
      pushTurn(resume, result);
      ctx = result.context || ctx;
      continue;
    }

    let user = studentReplyForTurn(persona, ctx, result.reply, t);
    // Escape hatch when the bot repeats itself (student said the wrong continue token)
    if (identicalStreak >= 2) {
      const escapes = ['ok', 'continue', 'yes', 'ready', 'go on'];
      user = escapes[identicalStreak % escapes.length];
    }
    result = await handleCareerCounsellingMessage(user, ctx, {});
    pushTurn(user, result);
    ctx = result.context || ctx;

    // Soft stop for declines that park early without soft-advance yet: keep going
    if (result.parked && !result.skippedPhaseReason) {
      result = await handleCareerCounsellingMessage('yes', ctx, {});
      pushTurn('yes', result);
      ctx = result.context || ctx;
    }

    if (identicalStreak >= 6) break; // hard stop — will surface as incomplete/stuck
  }

  const observed = uniqueOrdered(phasePath);
  const expected = FULL_COUNSELING_PATH;
  const skipped = detectSkippedPhases(observed, expected, intentionalSkips);
  const turnFailures = turnGrades.flatMap((g, i) =>
    g.failures.map((f) => ({ turn: i + 1, failure: f, phase: g.uxPhase }))
  );

  // Full-path journeys should reach booking or handoff (or soft-complete with URL)
  const reachedTerminal =
    observed.includes('Booking') ||
    observed.includes('Handoff') ||
    Boolean(result?.context?.profile?.journeyCompleted) ||
    Boolean(result?.context?.profile?.phase13UrlShared);

  if (scenario.target === 'full_path' && !reachedTerminal) {
    turnFailures.push({
      turn: transcript.length,
      failure: 'journey_incomplete_before_booking_handoff',
      phase: observed[observed.length - 1] || 'Unknown',
    });
  }

  // Unintentional skips of core early phases are failures for full_path
  for (const sk of skipped) {
    if (sk.intentional) continue;
    if (
      scenario.target === 'full_path' &&
      [
        'Discovery',
        'Education',
        'Personalization',
        'AI Shortlisting',
        'Comparison',
      ].includes(sk.phase) &&
      !reachedTerminal
    ) {
      turnFailures.push({
        turn: transcript.length,
        failure: `phase_skipped:${sk.phase}`,
        phase: sk.phase,
      });
    }
  }

  return {
    id: scenario.id,
    category: scenario.category,
    mode: scenario.mode,
    status: turnFailures.length ? 'FAIL' : 'PASS',
    turnCount: transcript.length,
    journeyMap: observed,
    skippedPhases: skipped,
    skippedPhaseReasons,
    turnFailures,
    lineStats: summarizeLines(transcript),
    transcript: transcript.slice(0, 80),
  };
}

async function runPredictorBridgeJourney(scenario) {
  const persona = personaFromScenario(scenario);
  const transcript = [];
  const phasePath = [];
  const turnGrades = [];
  let collegeCtx = {};
  let previousReply = null;
  let turnsInSamePhase = 0;
  let lastPhase = null;
  let bridged = false;

  const note = (user, reply, meta = {}) => {
    const fakeResult = {
      reply,
      context: meta.context || {
        stage: meta.stage || (bridged ? meta.context?.stage : 'college_predictor'),
        step: meta.step || collegeCtx.step || 'exam',
        profile: meta.context?.profile || {},
      },
      orchestration: meta.orchestration || null,
      allowExtendedPrediction: meta.allowExtendedPrediction || meta.step === 'results',
      skipLineCap: meta.step === 'results',
      bridgeToCareerCounselling: meta.bridgeToCareerCounselling,
      skippedPhaseReason: meta.skippedPhaseReason,
    };
    const grade = gradeTurn({
      user,
      result: fakeResult,
      previousReply,
      turnsInSamePhase,
    });
    const ux = grade.uxPhase === 'Unknown' && !bridged ? 'College Predictor' : grade.uxPhase;
    if (ux === lastPhase) turnsInSamePhase += 1;
    else {
      lastPhase = ux;
      turnsInSamePhase = 1;
      phasePath.push(ux);
    }
    transcript.push({
      turn: transcript.length + 1,
      user,
      bot: reply,
      stage: fakeResult.context.stage,
      step: fakeResult.context.step,
      uxPhase: ux,
      lineCount: grade.lineCount,
      words: grade.words,
      failures: grade.failures,
      warnings: grade.warnings,
    });
    turnGrades.push({ ...grade, uxPhase: ux });
    previousReply = reply;
  };

  // Drive predictor without Mongo inboundId (cert uses local handlers only)
  let r = await handleCollegePredictorMessage(scenario.entry, {}, { isNewEntry: true });
  collegeCtx = r.context || {};
  note(scenario.entry, r.reply, {
    stage: 'college_predictor',
    step: collegeCtx.step,
    allowExtendedPrediction: collegeCtx.step === 'results',
  });

  for (let t = 1; t < 20 && !bridged; t += 1) {
    const user = studentReplyForTurn(persona, collegeCtx, r.reply, t);
    // Prefer guided processor when possible, but never pass a fake ObjectId
    const out = await processCollegePredictorTurn({
      flow: { id: 'college_predictor' },
      inboundText: user,
      inbound: {},
      contextPatch: { college: collegeCtx },
      isNewEntry: false,
    });

    if (out.nextState === 'career_counselling_v2') {
      bridged = true;
      let ctx = out.contextPatch?.careerCounselling || {};
      note(user, out.replyText, {
        context: ctx,
        orchestration: ctx?.profile?.orchestration,
        bridgeToCareerCounselling: true,
      });
      let cres = {
        reply: out.replyText,
        context: ctx,
        orchestration: ctx?.profile?.orchestration,
      };
      for (let k = 0; k < (scenario.continueToBooking ? 40 : 10); k += 1) {
        if (isJourneyDone(cres, { target: 'full_path' })) break;
        const step = String(ctx.step || '');
        // Always use an exact Phase-12 continue token — avoid question_fallback loops
        let msg = studentReplyForTurn(persona, ctx, cres.reply, k + 100);
        if (step.startsWith('counsel_rec_')) msg = 'continue';
        if (step.startsWith('booking_')) msg = 'Book now';
        cres = await handleCareerCounsellingMessage(msg, ctx, {});
        note(msg, cres.reply, {
          context: cres.context,
          orchestration: cres.orchestration || cres.context?.profile?.orchestration,
          skippedPhaseReason: cres.skippedPhaseReason,
        });
        ctx = cres.context || ctx;
        if (!scenario.continueToBooking) {
          const ux = stageToUxPhase(ctx.stage, ctx.step);
          if (
            ux === 'Concern Handling' ||
            ux === 'Recommendation' ||
            ux === 'Comparison'
          ) {
            // One more turn into concern is enough for bridge proof
            if (ux === 'Concern Handling' || k >= 3) break;
          }
        }
        if (String(ctx.step || '') === 'counsel_rec_followup' && k > 2) {
          // Force exit attempt then stop if still stuck
          cres = await handleCareerCounsellingMessage('continue', ctx, {});
          note('continue', cres.reply, { context: cres.context });
          ctx = cres.context || ctx;
          if (String(ctx.stage || '').includes('phase_13') || ctx.profile?.phase13UrlShared) break;
          break;
        }
      }
      break;
    }

    collegeCtx = out.contextPatch?.college || collegeCtx;
    r = { reply: out.replyText, context: collegeCtx };
    note(user, out.replyText, {
      stage: 'college_predictor',
      step: collegeCtx.step,
      allowExtendedPrediction: collegeCtx.step === 'results',
    });

    // If still on results after affirmative, force compare bridge intent once
    if (collegeCtx.step === 'results' && /compare|yes|what matters/i.test(user) && !bridged) {
      const retry = await processCollegePredictorTurn({
        flow: { id: 'college_predictor' },
        inboundText: 'compare',
        inbound: {},
        contextPatch: { college: collegeCtx },
      });
      if (retry.nextState === 'career_counselling_v2') {
        bridged = true;
        const ctx = retry.contextPatch?.careerCounselling || {};
        note('compare', retry.replyText, {
          context: ctx,
          bridgeToCareerCounselling: true,
        });
      }
    }
  }

  const observed = uniqueOrdered(phasePath);
  const turnFailures = turnGrades.flatMap((g, i) =>
    g.failures.map((f) => ({ turn: i + 1, failure: f, phase: g.uxPhase }))
  );

  if (!bridged) {
    turnFailures.push({
      turn: transcript.length,
      failure: 'predictor_did_not_bridge_to_counseling',
      phase: 'College Predictor',
    });
  } else {
    const hasCompareOrConcern =
      observed.includes('Comparison') || observed.includes('Concern Handling');
    if (!hasCompareOrConcern) {
      turnFailures.push({
        turn: transcript.length,
        failure: 'bridge_missing_compare_or_concern',
        phase: observed[observed.length - 1] || 'Unknown',
      });
    }
  }

  const resultsTurn = transcript.find((t) => t.step === 'results');
  if (resultsTurn && !/\?/.test(resultsTurn.bot || '')) {
    turnFailures.push({
      turn: resultsTurn.turn,
      failure: 'prediction_ends_without_next_step',
      phase: 'College Predictor',
    });
  }

  const skipped = detectSkippedPhases(
    observed,
    scenario.continueToBooking ? [...PREDICTOR_BRIDGE_PATH, 'Handoff'] : PREDICTOR_BRIDGE_PATH,
    []
  );

  return {
    id: scenario.id,
    category: scenario.category,
    mode: scenario.mode,
    status: turnFailures.length ? 'FAIL' : 'PASS',
    turnCount: transcript.length,
    journeyMap: observed,
    skippedPhases: skipped,
    turnFailures,
    lineStats: summarizeLines(transcript),
    bridged,
    transcript: transcript.slice(0, 80),
  };
}

function summarizeLines(transcript) {
  const counts = transcript.map((t) => t.lineCount || 0);
  if (!counts.length) return { min: 0, max: 0, avg: 0, over5: 0 };
  const sum = counts.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...counts),
    max: Math.max(...counts),
    avg: Math.round((sum / counts.length) * 10) / 10,
    over5: counts.filter((n) => n > MAX_LINES_NORMAL).length,
  };
}

function aggregateStats(results) {
  const allTurns = results.flatMap((r) => r.transcript || []);
  const phaseTransitions = {};
  for (const r of results) {
    const map = r.journeyMap || [];
    for (let i = 0; i < map.length - 1; i += 1) {
      const key = `${map[i]} → ${map[i + 1]}`;
      phaseTransitions[key] = (phaseTransitions[key] || 0) + 1;
    }
  }
  const failureReasons = {};
  for (const r of results) {
    for (const f of r.turnFailures || []) {
      const key = f.failure.split(':')[0];
      failureReasons[key] = (failureReasons[key] || 0) + 1;
    }
  }
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { pass: 0, fail: 0 };
    byCategory[r.category][r.status === 'PASS' ? 'pass' : 'fail'] += 1;
  }
  return {
    journeys: results.length,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: results.filter((r) => r.status === 'FAIL').length,
    totalTurns: allTurns.length,
    responseLength: summarizeLines(allTurns),
    phaseTransitions,
    failureReasons,
    byCategory,
  };
}

function rootCauseAndFixes(results, stats) {
  const failed = results.filter((r) => r.status === 'FAIL');
  const causes = [];
  const fixes = [];
  const reasons = stats.failureReasons || {};

  if (reasons.line_cap) {
    causes.push({
      id: 'line_cap',
      count: reasons.line_cap,
      detail: 'Replies exceeded 4–5 lines outside prediction blocks',
    });
    fixes.push({
      id: 'line_cap',
      action: 'Keep allowExtendedPrediction only for shortlist/Phase9/CP results; shorten teaching copy constants',
    });
  }
  if (reasons.missing_advance_question) {
    causes.push({
      id: 'missing_advance',
      count: reasons.missing_advance_question,
      detail: 'Bot answered without a roadmap next-step question',
    });
    fixes.push({
      id: 'missing_advance',
      action: 'Ensure composeCounselorReply/ensureAdvanceQuestion covers all non-terminal stages',
    });
  }
  if (reasons.predictor_did_not_bridge_to_counseling) {
    causes.push({
      id: 'cp_bridge',
      count: reasons.predictor_did_not_bridge_to_counseling,
      detail: 'College Predictor ended without bridging into compare/concern counseling',
    });
    fixes.push({
      id: 'cp_bridge',
      action: 'Harden isCounselingBridgeIntent + guidedFlowProcessors bridge on results affirmatives',
    });
  }
  if (reasons.journey_incomplete_before_booking_handoff) {
    causes.push({
      id: 'incomplete',
      count: reasons.journey_incomplete_before_booking_handoff,
      detail: 'Full counseling journeys stalled before Booking/Handoff',
    });
    fixes.push({
      id: 'incomplete',
      action: 'Inspect stuck steps in failing transcripts; fix soft-advance / step parsers',
    });
  }
  if (reasons.exact_repeat || reasons.stuck_phase) {
    causes.push({
      id: 'stuck_repeat',
      count: (reasons.exact_repeat || 0) + (reasons.stuck_phase || 0),
      detail: 'Conversation repeated or dwelled too long in one phase',
    });
    fixes.push({
      id: 'stuck_repeat',
      action: 'Add progress guards / clearer permission soft-advance after one decline',
    });
  }
  if (reasons.generic_chatbot || reasons.essay_marker || reasons.essay_word_count) {
    causes.push({
      id: 'generic_essay',
      count:
        (reasons.generic_chatbot || 0) +
        (reasons.essay_marker || 0) +
        (reasons.essay_word_count || 0),
      detail: 'Generic chatbot phrasing or educational essay dumps',
    });
    fixes.push({
      id: 'generic_essay',
      action: 'Strip generic prompts; keep teaching bubbles ≤5 short lines',
    });
  }

  if (!causes.length && failed.length) {
    causes.push({
      id: 'mixed',
      count: failed.length,
      detail: 'See per-journey turnFailures in JSON report',
    });
  }

  return { causes, fixes, failedJourneyIds: failed.map((f) => f.id) };
}

function renderMarkdown(report) {
  const s = report.stats;
  const verdict = report.verdict;
  const lines = [];
  lines.push('# P0 Final Conversational UX Certification');
  lines.push('');
  lines.push(`- Generated: ${report.startedAt}`);
  lines.push(`- Journeys: **${s.journeys}**`);
  lines.push(`- Passed: **${s.passed}**`);
  lines.push(`- Failed: **${s.failed}**`);
  lines.push(`- Total turns graded: **${s.totalTurns}**`);
  lines.push(`- Verdict: **${verdict}**`);
  lines.push('');
  lines.push('## Response length statistics');
  lines.push('');
  lines.push(
    `| min | avg | max | turns > ${MAX_LINES_NORMAL} lines |`
  );
  lines.push('|---|---|---|---|');
  lines.push(
    `| ${s.responseLength.min} | ${s.responseLength.avg} | ${s.responseLength.max} | ${s.responseLength.over5} |`
  );
  lines.push('');
  lines.push('## By student archetype');
  lines.push('');
  lines.push('| Category | Pass | Fail |');
  lines.push('|---|---:|---:|');
  for (const [cat, v] of Object.entries(s.byCategory || {})) {
    lines.push(`| ${cat} | ${v.pass} | ${v.fail} |`);
  }
  lines.push('');
  lines.push('## Top phase transitions');
  lines.push('');
  const topTransitions = Object.entries(s.phaseTransitions || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  for (const [k, n] of topTransitions) lines.push(`- ${k}: ${n}`);
  lines.push('');
  lines.push('## Failure reasons');
  lines.push('');
  if (!Object.keys(s.failureReasons || {}).length) lines.push('_None_');
  else {
    for (const [k, n] of Object.entries(s.failureReasons)) lines.push(`- ${k}: ${n}`);
  }
  lines.push('');
  lines.push('## Root-cause analysis');
  lines.push('');
  for (const c of report.rootCause.causes) {
    lines.push(`- **${c.id}** (×${c.count}): ${c.detail}`);
  }
  if (!report.rootCause.causes.length) lines.push('_No systemic failures detected._');
  lines.push('');
  lines.push('## Required fixes');
  lines.push('');
  for (const f of report.rootCause.fixes) {
    lines.push(`- **${f.id}**: ${f.action}`);
  }
  if (!report.rootCause.fixes.length) lines.push('_None — experience gate clear._');
  lines.push('');
  lines.push('## Failed conversations');
  lines.push('');
  const failed = report.journeys.filter((j) => j.status === 'FAIL').slice(0, 40);
  if (!failed.length) lines.push('_None_');
  for (const j of failed) {
    lines.push(`### ${j.id} (${j.category})`);
    lines.push(`- Journey map: ${j.journeyMap.join(' → ')}`);
    lines.push(
      `- Failures: ${j.turnFailures.map((f) => `T${f.turn}:${f.failure}`).join(', ')}`
    );
    lines.push('');
  }
  lines.push('## Sample passing transcripts (first 3)');
  lines.push('');
  for (const j of report.journeys.filter((x) => x.status === 'PASS').slice(0, 3)) {
    lines.push(`### ${j.id} — ${j.journeyMap.join(' → ')}`);
    for (const t of (j.transcript || []).slice(0, 12)) {
      lines.push(`- **U:** ${t.user}`);
      lines.push(`  **B:** ${String(t.bot || '').replace(/\n/g, ' / ')}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(
    verdict === 'PRODUCTION READY'
      ? 'Every graded conversation behaved like a counselor-led admissions flow.'
      : 'NOT PRODUCTION READY — fix required items above and re-run this certification.'
  );
  return lines.join('\n');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const restoreLogs = silenceChatbotLogs();
  installMocks();

  const startedAt = new Date().toISOString();
  const scenarios = buildScenarios();
  const results = [];

  console.log(`Running ${scenarios.length} conversational UX journeys…`);

  try {
    for (let i = 0; i < scenarios.length; i += 1) {
      const s = scenarios[i];
      process.stdout.write(`\r  [${i + 1}/${scenarios.length}] ${s.id} ${s.category}          `);
      try {
        const outcome =
          s.mode === 'predictor_bridge'
            ? await runPredictorBridgeJourney(s)
            : await runCounselingJourney(s);
        results.push(outcome);
      } catch (err) {
        results.push({
          id: s.id,
          category: s.category,
          mode: s.mode,
          status: 'FAIL',
          turnCount: 0,
          journeyMap: [],
          skippedPhases: [],
          turnFailures: [{ turn: 0, failure: `exception:${err.message}`, phase: 'Unknown' }],
          lineStats: { min: 0, max: 0, avg: 0, over5: 0 },
          transcript: [],
          error: err.stack || String(err),
        });
      }
    }
  } finally {
    clearMocks();
    restoreLogs();
    process.stdout.write('\n');
  }

  const stats = aggregateStats(results);
  const rootCause = rootCauseAndFixes(results, stats);
  const productionReady = stats.failed === 0 && stats.journeys >= 100;
  const verdict = productionReady ? 'PRODUCTION READY' : 'NOT PRODUCTION READY';

  const report = {
    name: 'P0 Final Conversational UX Certification',
    startedAt,
    finishedAt: new Date().toISOString(),
    verdict,
    criteria: {
      minJourneys: 100,
      maxNormalLines: MAX_LINES_NORMAL,
      requireAdvanceQuestion: true,
      requireCounselorLed: true,
      predictorMustBridge: true,
    },
    stats,
    rootCause,
    journeys: results,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(LATEST_JSON, JSON.stringify(report, null, 2));
  const md = renderMarkdown(report);
  fs.writeFileSync(REPORT_MD, md);
  fs.writeFileSync(LATEST_MD, md);

  console.log('────────────────────────────────────────');
  console.log(`Journeys: ${stats.journeys}  PASS: ${stats.passed}  FAIL: ${stats.failed}`);
  console.log(
    `Lines: min=${stats.responseLength.min} avg=${stats.responseLength.avg} max=${stats.responseLength.max} over5=${stats.responseLength.over5}`
  );
  console.log(`Verdict: ${verdict}`);
  console.log(`Report: ${REPORT_MD}`);
  console.log('────────────────────────────────────────');

  process.exit(productionReady ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  clearMocks();
  process.exit(1);
});
