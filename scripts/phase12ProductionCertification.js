'use strict';

/**
 * Phase 12 Counseling Experience Selection — local production certification.
 * Run: node scripts/phase12ProductionCertification.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  STAGES,
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  selectCounselingService,
  shouldSkipPhase12,
  buildPersonalizedServiceReply,
  COUNSELING_SERVICES,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2CounselingExperienceSelectionCore');
const {
  startCounselingExperienceSelection,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2CounselingExperienceSelectionEngine');
const {
  setShortlistingEligibilityDeps,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
const { bookingPageUrl } = require('../services/chatbot/bookingContext/bookingContextResolver');

const OUT_DIR = path.join(__dirname, '..', 'smoke-results', 'sectionF');
const PASS_GATE = Number(process.env.PHASE12_PASS_GATE || 1);
const bookingRe = new RegExp(bookingPageUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const mockColleges = [
  {
    college_name: 'Hyderabad Tech University',
    college_address: 'Hyderabad',
    district_enum: 'HYDERABAD',
    branches: [
      {
        branch_name: 'Computer Science and Engineering',
        branch_code: 'CSE',
        fee: 180000,
        cutoff: 25000,
        reservation_categories: [{ cutoff_rank: 25000 }],
      },
    ],
  },
  {
    college_name: 'Andhra Engineering College',
    college_address: 'Visakhapatnam',
    district_enum: 'VISAKHAPATNAM',
    branches: [
      {
        branch_name: 'Information Technology',
        branch_code: 'INF',
        fee: 220000,
        cutoff: 32000,
        reservation_categories: [{ cutoff_rank: 32000 }],
      },
    ],
  },
  {
    college_name: 'Coastal Institute of Technology',
    college_address: 'Kakinada',
    district_enum: 'EAST GODAVARI',
    branches: [
      {
        branch_name: 'Electronics and Communication Engineering',
        branch_code: 'ECE',
        fee: 150000,
        cutoff: 40000,
        reservation_categories: [{ cutoff_rank: 40000 }],
      },
    ],
  },
  {
    college_name: 'Rayalaseema University College',
    college_address: 'Tirupati',
    district_enum: 'CHITTOOR',
    branches: [
      {
        branch_name: 'Computer Science and Engineering',
        branch_code: 'CSE',
        fee: 160000,
        cutoff: 45000,
        reservation_categories: [{ cutoff_rank: 45000 }],
      },
    ],
  },
  {
    college_name: 'Deccan Institute of Engineering',
    college_address: 'Hyderabad',
    district_enum: 'RANGAREDDY',
    branches: [
      {
        branch_name: 'Computer Science and Engineering',
        branch_code: 'CSE',
        fee: 210000,
        cutoff: 50000,
        reservation_categories: [{ cutoff_rank: 50000 }],
      },
    ],
  },
  {
    college_name: 'Godavari College of Engineering',
    college_address: 'Rajahmundry',
    district_enum: 'EAST GODAVARI',
    branches: [
      {
        branch_name: 'Information Technology',
        branch_code: 'INF',
        fee: 140000,
        cutoff: 55000,
        reservation_categories: [{ cutoff_rank: 55000 }],
      },
    ],
  },
  {
    college_name: 'Nellore Institute of Technology',
    college_address: 'Nellore',
    district_enum: 'NELLORE',
    branches: [
      {
        branch_name: 'Computer Science and Engineering',
        branch_code: 'CSE',
        fee: 175000,
        cutoff: 60000,
        reservation_categories: [{ cutoff_rank: 60000 }],
      },
    ],
  },
];

async function journeyToPhase12() {
  let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
  const script = [
    'Class 12',
    'B.Tech',
    'Software engineer',
    'not yet',
    'English',
    'ok',
    'ok',
    'ok',
    'ok',
    'projects and mentoring',
    'yes',
    'yes',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'hands-on projects with internships',
    'yes',
    'ok',
    'placements and skill building',
    'Hyderabad, open to relocate, hostel ok',
    'around 2-3 lakhs',
    'parents prefer good brand nearby',
    'worried about fees and wrong branch',
  ];
  for (const msg of script) {
    r = await handleCareerCounsellingMessage(msg, r.context);
  }
  if (r.context.step === 'pers_clarify') {
    r = await handleCareerCounsellingMessage('placements', r.context);
  }
  for (const msg of [
    'yes',
    'TS EAMCET',
    '15000',
    'OC Boys',
    'yes',
    '1 and 2',
    'continue',
    'yes',
    'continue',
    'yes',
    'continue',
    'continue',
    'ready',
  ]) {
    r = await handleCareerCounsellingMessage(msg, r.context);
  }
  return r;
}

function caseResult(id, group, title, fn) {
  const started = Date.now();
  try {
    const detail = fn();
    return { id, group, title, status: 'PASS', detail: detail || 'ok', durationMs: Date.now() - started };
  } catch (err) {
    return {
      id,
      group,
      title,
      status: 'FAIL',
      detail: err.message || String(err),
      durationMs: Date.now() - started,
    };
  }
}

async function caseResultAsync(id, group, title, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    return { id, group, title, status: 'PASS', detail: detail || 'ok', durationMs: Date.now() - started };
  } catch (err) {
    return {
      id,
      group,
      title,
      status: 'FAIL',
      detail: err.message || String(err),
      durationMs: Date.now() - started,
    };
  }
}

function renderMarkdown(report) {
  const lines = [
    `# ${report.title}`,
    '',
    `- Mode: ${report.mode}`,
    `- Pass rate: ${(report.summary.passRate * 100).toFixed(1)}%`,
    `- Result: **${report.summary.overall}**`,
    '',
    '| ID | Group | Status | Detail |',
    '|----|-------|--------|--------|',
  ];
  for (const r of report.results) {
    lines.push(
      `| ${r.id} | ${r.group} | ${r.status} | ${String(r.detail).replace(/\|/g, '/').slice(0, 80)} |`
    );
  }
  return lines.join('\n') + '\n';
}

async function main() {
  setShortlistingEligibilityDeps({
    fetchCollegeDostColleges: async () => ({
      colleges: mockColleges,
      total_no_of_colleges: mockColleges.length,
    }),
  });

  const results = [];

  results.push(
    await caseResultAsync('P12-01', 'entry', 'Enters Phase 12 from Phase 11 ready path', async () => {
      const r = await journeyToPhase12();
      assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
      assert.equal(r.context.profile.phase12Presented, true);
      assert.ok(r.context.profile.phase12Service);
      return r.context.profile.phase12Service;
    })
  );

  results.push(
    caseResult('P12-02', 'selection', 'Selects admission when admission signals dominate', () => {
      const sel = selectCounselingService({
        phase11ConfidenceCheck: 'yes',
        phase11LastHesitationRaw: 'how do I get admission eligibility clarity',
        preferredCourse: 'B.Tech',
      });
      assert.equal(sel.service, COUNSELING_SERVICES.ADMISSION);
      return 'admission';
    })
  );

  results.push(
    caseResult('P12-03', 'selection', 'Selects one_on_one for parent signals', () => {
      const sel = selectCounselingService({
        phase11ConfidenceCheck: 'yes',
        parentPreferences: 'parents want local brand',
        preferredCourse: 'B.Tech',
      });
      assert.equal(sel.service, COUNSELING_SERVICES.ONE_ON_ONE);
      return 'one_on_one';
    })
  );

  results.push(
    caseResult('P12-04', 'selection', 'Selects career for pathway clarity signals', () => {
      const sel = selectCounselingService({
        phase11ConfidenceCheck: 'yes',
        careerGoal: 'Software engineer',
        futurePathVisionPresented: true,
        studentPriorities: ['placements', 'projects'],
      });
      assert.equal(sel.service, COUNSELING_SERVICES.CAREER);
      return 'career';
    })
  );

  results.push(
    caseResult('P12-05', 'selection', 'Selects none when confident without residual signals', () => {
      const sel = selectCounselingService({
        phase11ConfidenceCheck: 'ready',
        preferredCourse: 'B.Tech',
      });
      assert.equal(sel.service, COUNSELING_SERVICES.NONE);
      return 'none';
    })
  );

  results.push(
    await caseResultAsync('P12-06', 'personalization', 'Personalized reply has no booking URL', async () => {
      const r = await journeyToPhase12();
      assert.doesNotMatch(r.reply, bookingRe);
      assert.doesNotMatch(r.reply, /https?:\/\//i);
      assert.doesNotMatch(r.reply, /guaranteed|mandatory|must book/i);
      assert.match(r.reply, /counseling experience|optional|Continue|Not now/i);
      return 'no-url';
    })
  );

  results.push(
    await caseResultAsync('P12-07', 'transition', 'Continue → Phase 13 CTA without URL', async () => {
      let r = await journeyToPhase12();
      r = await handleCareerCounsellingMessage('continue', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_13_BOOKING_ORCHESTRATOR);
      assert.equal(r.context.profile.phase12Outcome, 'continued');
      assert.equal(r.context.step, 'booking_intro');
      assert.doesNotMatch(r.reply, bookingRe);
      assert.doesNotMatch(r.reply, /https?:\/\//i);
      return 'phase13-cta';
    })
  );

  results.push(
    caseResult('P12-08', 'skip', 'Skip gate when Phase 11 escalated', () => {
      const skip = shouldSkipPhase12({ phase11Escalated: true });
      assert.equal(skip.skip, true);
      const started = startCounselingExperienceSelection({
        profile: { phase11Escalated: true },
      });
      assert.equal(started.context.profile.phase12Outcome, 'skipped_already_offered');
      assert.doesNotMatch(started.reply, /https?:\/\//i);
      return 'skip-escalation';
    })
  );

  results.push(
    caseResult('P12-09', 'skip', 'Skip gate when NIAT One-on-One shown', () => {
      const skip = shouldSkipPhase12({ niatOneOnOneRecommended: true });
      assert.equal(skip.skip, true);
      const started = startCounselingExperienceSelection({
        profile: { niatOneOnOneRecommended: true },
      });
      assert.equal(started.context.stage, 'conversation_complete');
      return 'skip-niat';
    })
  );

  results.push(
    await caseResultAsync('P12-10', 'negative', 'No duplicate OOO URL after normal Phase 12', async () => {
      const r = await journeyToPhase12();
      assert.equal(r.context.profile.phase11Escalated, false);
      assert.doesNotMatch(r.reply, /one-on-one-session/i);
      return 'no-duplicate';
    })
  );

  results.push(
    await caseResultAsync('P12-11', 'negative', 'Does not mutate rankings', async () => {
      let r = await journeyToPhase12();
      const before = JSON.stringify(r.context.profile.recommendedColleges);
      const reasons = JSON.stringify(r.context.profile.phase9Recommendations);
      r = await handleCareerCounsellingMessage('continue', r.context);
      assert.equal(JSON.stringify(r.context.profile.recommendedColleges), before);
      assert.equal(JSON.stringify(r.context.profile.phase9Recommendations), reasons);
      return 'immutable';
    })
  );

  results.push(
    await caseResultAsync('P12-12', 'negative', 'Does not restart Phase 11', async () => {
      let r = await journeyToPhase12();
      r = await handleCareerCounsellingMessage('I am still unsure about deciding', r.context);
      assert.notEqual(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
      assert.notEqual(r.context.step, 'hesitation_ask');
      return 'no-phase11-restart';
    })
  );

  results.push(
    caseResult('P12-13', 'guardrail', 'Personalization never includes URL or guarantees', () => {
      const built = buildPersonalizedServiceReply(
        {
          preferredCourse: 'B.Tech',
          careerGoal: 'Engineer',
          phase9Recommendations: [{ collegeName: 'College A', rankLabel: 'Best Match' }],
          parentPreferences: 'parents nearby',
        },
        { service: COUNSELING_SERVICES.ONE_ON_ONE, reasons: ['parent_alignment'] }
      );
      assert.doesNotMatch(built.reply, /https?:\/\//i);
      assert.doesNotMatch(built.reply, /guaranteed|mandatory/i);
      return 'guardrails';
    })
  );

  setShortlistingEligibilityDeps({});

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const passRate = results.length ? pass / results.length : 0;
  const overall = fail === 0 && passRate >= PASS_GATE ? 'PASS' : 'FAIL';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    section: 'F-Phase12',
    title: 'Phase 12 Counseling Experience Selection — Production Certification',
    mode: 'local_deterministic',
    summary: { total: results.length, pass, fail, passRate, gate: PASS_GATE, overall },
    results,
    failures: results.filter((r) => r.status === 'FAIL'),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `phase12-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `phase12-certification-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  process.exit(overall === 'FAIL' ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
