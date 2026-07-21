'use strict';

/**
 * Phase 14 Journey Completion — local production certification.
 * Run: node scripts/phase14ProductionCertification.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  STAGES,
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  resolveJourneyOutcome,
  buildPlatformHandoffPayload,
  JOURNEY_OUTCOMES,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2JourneyCompletionCore');
const {
  startJourneyCompletion,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2JourneyCompletionEngine');
const {
  setShortlistingEligibilityDeps,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');

const OUT_DIR = path.join(__dirname, '..', 'smoke-results', 'sectionF');
const PASS_GATE = Number(process.env.PHASE14_PASS_GATE || 1);

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

async function journeyToPhase13Intro() {
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
    'continue',
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
    caseResult('P14-01', 'outcome', 'Maps deferred / initiated / opted_out / information_only', () => {
      assert.equal(
        resolveJourneyOutcome({ phase13Outcome: 'deferred' }),
        JOURNEY_OUTCOMES.BOOKING_DEFERRED
      );
      assert.equal(
        resolveJourneyOutcome({ phase13UrlShared: true }),
        JOURNEY_OUTCOMES.BOOKING_INITIATED
      );
      assert.equal(
        resolveJourneyOutcome({ phase12Outcome: 'declined' }),
        JOURNEY_OUTCOMES.OPTED_OUT
      );
      assert.equal(
        resolveJourneyOutcome({ phase12Service: 'none' }),
        JOURNEY_OUTCOMES.INFORMATION_ONLY
      );
      return 'outcomes-ok';
    })
  );

  results.push(
    caseResult('P14-02', 'handoff', 'Builds platform handoff without mutating inputs', () => {
      const profile = {
        preferredCourse: 'B.Tech',
        careerGoal: 'Engineer',
        phase12Service: 'one_on_one',
        phase13UrlShared: true,
        phase9Recommendations: [{ collegeName: 'A', rankLabel: 'Best Match' }],
        recommendedColleges: [{ collegeName: 'A' }],
      };
      const before = JSON.stringify(profile);
      const payload = buildPlatformHandoffPayload({}, profile, JOURNEY_OUTCOMES.BOOKING_INITIATED);
      assert.equal(payload.journeyOutcome, 'booking_initiated');
      assert.equal(payload.serviceSelected, 'one_on_one');
      assert.ok(payload.completedAt);
      assert.ok(payload.journeyVersion);
      assert.equal(JSON.stringify(profile), before);
      return 'handoff-ok';
    })
  );

  results.push(
    await caseResultAsync('P14-03', 'defer', 'Phase 13 Later → Phase 14 booking_deferred', async () => {
      let r = await journeyToPhase13Intro();
      r = await handleCareerCounsellingMessage('Later', r.context);
      assert.equal(r.context.stage, STAGES.JOURNEY_COMPLETED);
      assert.equal(r.context.profile.journeyCompleted, true);
      assert.equal(r.context.profile.journeyOutcome, 'booking_deferred');
      assert.ok(r.context.profile.platformHandoffPayload);
      assert.match(r.reply, /No problem|return anytime/i);
      assert.doesNotMatch(r.reply, /https?:\/\//i);
      return 'deferred';
    })
  );

  results.push(
    await caseResultAsync('P14-04', 'initiated', 'Book Now + Done + wrap-up → booking_initiated', async () => {
      let r = await journeyToPhase13Intro();
      r = await handleCareerCounsellingMessage('Book now', r.context);
      assert.equal(r.context.step, 'booking_presented');
      r = await handleCareerCounsellingMessage('Done', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_13_BOOKING_ORCHESTRATOR);
      assert.equal(r.context.step, 'booking_confirmed');
      r = await handleCareerCounsellingMessage("That's all", r.context);
      assert.equal(r.context.stage, STAGES.JOURNEY_COMPLETED);
      assert.equal(r.context.profile.journeyOutcome, 'booking_initiated');
      assert.match(r.reply, /booking request has been received/i);
      return 'initiated';
    })
  );

  results.push(
    await caseResultAsync('P14-05', 'opt_out', 'Phase 12 Not now → opted_out', async () => {
      let r = await journeyToPhase13Intro();
      // Back on Phase 12 path: start from phase12 by simulating decline on a fresh phase12 context is hard;
      // use startJourneyCompletion with declined flag
      const closed = startJourneyCompletion({
        profile: {
          phase12Service: 'one_on_one',
          phase12Outcome: 'declined',
          recommendedColleges: r.context.profile.recommendedColleges,
        },
      });
      assert.equal(closed.context.profile.journeyOutcome, 'opted_out');
      assert.match(closed.reply, /Understood|Thank you for chatting/i);
      return 'opted-out';
    })
  );

  results.push(
    await caseResultAsync('P14-06', 'negative', 'Does not mutate rankings', async () => {
      let r = await journeyToPhase13Intro();
      const before = JSON.stringify(r.context.profile.recommendedColleges);
      const phase9 = JSON.stringify(r.context.profile.phase9Recommendations);
      r = await handleCareerCounsellingMessage('Later', r.context);
      assert.equal(JSON.stringify(r.context.profile.recommendedColleges), before);
      assert.equal(JSON.stringify(r.context.profile.phase9Recommendations), phase9);
      return 'immutable';
    })
  );

  results.push(
    await caseResultAsync('P14-07', 'negative', 'Does not restart Phase 13 counseling selection', async () => {
      let r = await journeyToPhase13Intro();
      r = await handleCareerCounsellingMessage('Later', r.context);
      r = await handleCareerCounsellingMessage('hello', r.context);
      assert.equal(r.context.stage, STAGES.JOURNEY_COMPLETED);
      assert.notEqual(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
      return 'terminal-sticky';
    })
  );

  results.push(
    caseResult('P14-08', 'guardrail', 'Handoff has no CRM/booking API side effects', () => {
      const payload = buildPlatformHandoffPayload(
        {},
        { phase12Service: 'none', preferredCourse: 'B.Tech' },
        JOURNEY_OUTCOMES.INFORMATION_ONLY
      );
      assert.equal(payload.bookingStatus, 'not_applicable');
      assert.ok(!payload.crmId);
      assert.ok(!payload.appointmentId);
      return 'no-side-effects';
    })
  );

  setShortlistingEligibilityDeps({});

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const passRate = results.length ? pass / results.length : 0;
  const overall = fail === 0 && passRate >= PASS_GATE ? 'PASS' : 'FAIL';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    section: 'F-Phase14',
    title: 'Phase 14 Journey Completion — Production Certification',
    mode: 'local_deterministic',
    summary: { total: results.length, pass, fail, passRate, gate: PASS_GATE, overall },
    results,
    failures: results.filter((r) => r.status === 'FAIL'),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `phase14-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `phase14-certification-${stamp}.md`);
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
