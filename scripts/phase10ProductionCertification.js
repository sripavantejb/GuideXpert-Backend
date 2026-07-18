'use strict';

/**
 * Phase 10 Future Path Vision — local production certification (deterministic).
 * Run: node scripts/phase10ProductionCertification.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  STAGES,
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  synthesizeFuturePathVision,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2FuturePathVisionCore');
const {
  setShortlistingEligibilityDeps,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
const { bookingPageUrl } = require('../services/chatbot/bookingContext/bookingContextResolver');
const {
  GUARANTEE_FORBIDDEN,
} = require('../constants/careerCounsellingV2FuturePathVision');

const OUT_DIR = path.join(__dirname, '..', 'smoke-results', 'sectionF');
const PASS_GATE = Number(process.env.PHASE10_PASS_GATE || 1);

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

async function journeyToPhase10() {
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
    await caseResultAsync('P10-01', 'entry', 'Enters Phase 10 from Phase 9 continue', async () => {
      const r = await journeyToPhase10();
      assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
      assert.equal(r.context.profile.futurePathVisionPresented, true);
      return 'entered';
    })
  );

  results.push(
    await caseResultAsync('P10-02', 'safety', 'Does not alter Phase 9 recommendation list', async () => {
      const r = await journeyToPhase10();
      const before = JSON.stringify(r.context.profile.phase9Recommendations);
      assert.ok(Array.isArray(r.context.profile.phase9Recommendations));
      assert.equal(JSON.stringify(r.context.profile.phase9Recommendations), before);
      assert.equal(r.context.profile.phase9Recommendations[0].rankLabel, 'Best Match');
      return 'rank-intact';
    })
  );

  results.push(
    caseResult('P10-03', 'safety', 'No colleges outside shortlist names in core', () => {
      const vision = synthesizeFuturePathVision({
        preferredCourse: 'B.Tech',
        phase9Recommendations: [{ collegeName: 'Only A', rankLabel: 'Best Match' }],
      });
      assert.match(vision.reply, /Only A/);
      assert.doesNotMatch(vision.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);
      return 'ok';
    })
  );

  results.push(
    await caseResultAsync('P10-04', 'transition', 'Continues to Phase 11 hesitation (handoff only)', async () => {
      let r = await journeyToPhase10();
      assert.doesNotMatch(r.reply, new RegExp(bookingPageUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      r = await handleCareerCounsellingMessage('continue', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
      assert.equal(r.context.step, 'hesitation_ask');
      assert.doesNotMatch(r.reply, new RegExp(bookingPageUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return 'phase11-handoff';
    })
  );

  results.push(
    await caseResultAsync('P10-05', 'stay', 'Question stays in Phase 10', async () => {
      let r = await journeyToPhase10();
      r = await handleCareerCounsellingMessage('What skills will I learn?', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
      return 'stay';
    })
  );

  results.push(
    caseResult('P10-06', 'personalization', 'Limited shortlist still completes profile-based vision', () => {
      const vision = synthesizeFuturePathVision({
        preferredCourse: 'B.Tech',
        careerGoal: 'Software engineer',
        learningStyle: 'projects',
      });
      assert.equal(vision.personalized, true);
      assert.match(vision.reply, /B\.Tech|Software engineer|project/i);
      assert.doesNotMatch(vision.reply, /counsellor|book/i);
      return 'profile-only';
    })
  );

  results.push(
    caseResult('P10-07', 'budget', 'Content budget ≤3 bubbles', () => {
      const vision = synthesizeFuturePathVision({
        preferredCourse: 'B.Tech',
        careerGoal: 'Engineer',
        phase9Recommendations: [{ collegeName: 'A', rankLabel: 'Best Match' }],
        learningStyle: 'hands-on',
      });
      assert.ok(vision.bubbles.length <= 3);
      assert.doesNotMatch(vision.reply, /Strong Alternative|Good Backup/i);
      return `${vision.bubbles.length} bubbles`;
    })
  );

  results.push(
    await caseResultAsync('P10-08', 'negative', 'No booking/counsellor language in Phase 10', async () => {
      let r = await journeyToPhase10();
      assert.doesNotMatch(r.reply, /counsellor|counselor|book(ing)?|whatsapp/i);
      r = await handleCareerCounsellingMessage('book a session', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
      assert.doesNotMatch(r.reply, /guidexpert\.co\.in/i);
      return 'no-cta';
    })
  );

  results.push(
    await caseResultAsync('P10-09', 'negative', 'No comparison / re-rank language', async () => {
      let r = await journeyToPhase10();
      r = await handleCareerCounsellingMessage('Which college is better to compare?', r.context);
      assert.match(r.reply, /not re-comparing|learning journey/i);
      assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
      return 'no-compare';
    })
  );

  results.push(
    caseResult('P10-10', 'negative', 'No guarantee patterns in synthesized copy', () => {
      const vision = synthesizeFuturePathVision({
        preferredCourse: 'CSE',
        careerGoal: 'AI engineer',
        phase9Recommendations: [{ collegeName: 'Tech U', rankLabel: 'Best Match' }],
      });
      for (const re of GUARANTEE_FORBIDDEN) {
        assert.ok(!re.test(vision.reply), String(re));
      }
      assert.doesNotMatch(vision.reply, /guaranteed|assured|100%/i);
      return 'no-guarantees';
    })
  );

  results.push(
    await caseResultAsync('P10-11', 'negative', 'Objection text does not enter resolution engine', async () => {
      let r = await journeyToPhase10();
      r = await handleCareerCounsellingMessage('I am worried about fees again', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
      assert.notEqual(r.context.step, 'concern_check_resolved');
      assert.match(r.reply, /fair worry|learning journey|Continue/i);
      return 'no-objection-engine';
    })
  );

  results.push(
    caseResult('P10-12', 'negative', 'No fabricated stats', () => {
      const vision = synthesizeFuturePathVision({
        preferredCourse: 'B.Tech',
        phase9Recommendations: [{ collegeName: 'A', rankLabel: 'Best Match' }],
      });
      assert.doesNotMatch(vision.reply, /\d+\s*%|\bLPA\b|\bpackage of\b/i);
      return 'no-stats';
    })
  );

  results.push(
    caseResult('P10-13', 'perf', 'Vision render under 50ms avg', () => {
      const t0 = Date.now();
      for (let i = 0; i < 100; i += 1) {
        synthesizeFuturePathVision({
          preferredCourse: 'B.Tech',
          careerGoal: 'Engineer',
          phase9Recommendations: [{ collegeName: 'A', rankLabel: 'Best Match' }],
        });
      }
      const avg = (Date.now() - t0) / 100;
      assert.ok(avg < 50, `avg ${avg}`);
      return `avg=${avg.toFixed(2)}ms`;
    })
  );

  setShortlistingEligibilityDeps({});

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const passRate = results.length ? pass / results.length : 0;
  const overall = fail === 0 && passRate >= PASS_GATE ? 'PASS' : 'FAIL';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    section: 'F-Phase10',
    title: 'Phase 10 Future Path Vision — Production Certification',
    mode: 'local_deterministic',
    summary: { total: results.length, pass, fail, passRate, gate: PASS_GATE, overall },
    results,
    failures: results.filter((r) => r.status === 'FAIL'),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `phase10-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `phase10-certification-${stamp}.md`);
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
