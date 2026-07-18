'use strict';

/**
 * Section F / Phase 9 — local production certification (deterministic).
 * Mirrors Section E unit-style cert: no live WhatsApp, no Section E changes.
 *
 * Run: node scripts/phase9ProductionCertification.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  STAGES,
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  synthesizePersonalizedRecommendation,
  selectRankedRecommendations,
  overallConfidenceLabel,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2PersonalizedRecommendationCore');
const {
  setShortlistingEligibilityDeps,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
const { bookingPageUrl } = require('../services/chatbot/bookingContext/bookingContextResolver');

const OUT_DIR = path.join(__dirname, '..', 'smoke-results', 'sectionF');
const PASS_GATE = Number(process.env.PHASE9_PASS_GATE || 1);

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

async function journeyToPhase9() {
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
  ]) {
    r = await handleCareerCounsellingMessage(msg, r.context);
  }
  return r;
}

function caseResult(id, group, title, fn) {
  const started = Date.now();
  try {
    const detail = fn();
    return {
      id,
      group,
      title,
      status: 'PASS',
      detail: detail || 'ok',
      durationMs: Date.now() - started,
    };
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
    return {
      id,
      group,
      title,
      status: 'PASS',
      detail: detail || 'ok',
      durationMs: Date.now() - started,
    };
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
    `- Gate: ${report.summary.gate}`,
    `- Result: **${report.summary.overall}**`,
    '',
    '## Cases',
    '',
    '| ID | Group | Status | ms | Detail |',
    '|----|-------|--------|----|--------|',
  ];
  for (const r of report.results) {
    lines.push(
      `| ${r.id} | ${r.group} | ${r.status} | ${r.durationMs} | ${String(r.detail).replace(/\|/g, '/').slice(0, 80)} |`
    );
  }
  if (report.failures.length) {
    lines.push('', '## Failures', '');
    for (const f of report.failures) {
      lines.push(`- **${f.id}**: ${f.detail}`);
    }
  }
  lines.push('', '## Regression', '');
  lines.push(`- Journey tests expected green via \`node --test test/careerCounsellingJourney.test.js\``);
  lines.push(`- Section E booking surfaces untouched (invitation still uses \`bookingPageUrl()\`)`);
  lines.push('');
  return lines.join('\n');
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
    await caseResultAsync('F9-01', 'F1_e2e', 'End-to-end reaches Phase 9 after concerns', async () => {
      const r = await journeyToPhase9();
      assert.equal(r.context.stage, STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION);
      assert.equal(r.context.profile.phase9Presented, true);
      return `stage=${r.context.stage}`;
    })
  );

  results.push(
    caseResult('F9-02', 'F2_quality', 'Recommendation quality: Phase 5 order + tier labels', () => {
      const syn = synthesizePersonalizedRecommendation({
        preferredCollege: 'B',
        decisionReasons: ['Practical curriculum lean'],
        recommendedColleges: [
          { collegeName: 'A', tier: 'best_match' },
          { collegeName: 'B', tier: 'strong_alternative' },
          { collegeName: 'C', tier: 'worth_exploring' },
          { collegeName: 'D', tier: 'worth_exploring' },
        ],
        recommendationConfidence: 70,
      });
      assert.equal(syn.items.length, 3);
      assert.equal(syn.items[0].collegeName, 'A');
      assert.equal(syn.items[0].rankLabel, 'Best Match');
      assert.equal(syn.items[1].collegeName, 'B');
      assert.equal(syn.items[1].rankLabel, 'Strong Alternative');
      assert.equal(syn.items[2].rankLabel, 'Good Backup');
      assert.match(syn.reply, /Comparison Insight:.*\bB\b/i);
      return syn.summary;
    })
  );

  results.push(
    caseResult('F9-02b', 'F2_quality', 'Comparison lean never promotes over Phase 5 Best Match', () => {
      const syn = synthesizePersonalizedRecommendation({
        preferredCollege: 'College B',
        decisionReasons: ['Internship opportunities'],
        recommendedColleges: [
          { collegeName: 'College A', tier: 'best_match' },
          { collegeName: 'College B', tier: 'strong_alternative' },
        ],
      });
      assert.equal(syn.items[0].collegeName, 'College A');
      assert.equal(syn.items[0].rankLabel, 'Best Match');
      assert.equal(syn.items[1].collegeName, 'College B');
      assert.doesNotMatch(syn.reply, /\*Best Match: College B\*/);
      assert.match(syn.reply, /Comparison Insight:.*College B/i);
      return 'rank-preserved';
    })
  );

  results.push(
    caseResult('F9-02c', 'F2_quality', 'Never inject preferredCollege outside shortlist', () => {
      const syn = synthesizePersonalizedRecommendation({
        preferredCollege: 'Ghost College',
        recommendedColleges: [{ collegeName: 'Only Shortlisted', tier: 'best_match' }],
      });
      assert.equal(syn.items.length, 1);
      assert.equal(syn.items[0].collegeName, 'Only Shortlisted');
      assert.ok(!syn.items.some((i) => i.collegeName === 'Ghost College'));
      assert.match(syn.reply, /context only/i);
      return 'no-injection';
    })
  );

  results.push(
    caseResult('F9-03', 'F2_quality', 'Reasoning references profile context', () => {
      const syn = synthesizePersonalizedRecommendation({
        preferredCourse: 'B.Tech CSE',
        careerGoal: 'Software engineer',
        budgetPreference: '2-3 lakhs',
        preferredCollege: 'Hyderabad Tech University',
        recommendedColleges: [
          { collegeName: 'Hyderabad Tech University', tier: 'best_match', branchName: 'CSE' },
        ],
        recommendationReasons: {
          'Hyderabad Tech University': {
            why: ['Aligns with your preferred course'],
            strengths: [],
            consider: [],
          },
        },
        recommendationConfidence: 80,
      });
      assert.match(syn.reply, /B\.Tech CSE|Software engineer|2-3 lakhs/i);
      assert.match(syn.reply, /Aligns with your preferred course/);
      return 'profile-anchored';
    })
  );

  results.push(
    caseResult('F9-04', 'F2_quality', 'Human confidence labels only (no raw scores)', () => {
      const syn = synthesizePersonalizedRecommendation({
        recommendedColleges: [{ collegeName: 'X', tier: 'best_match' }],
        recommendationConfidence: 88,
      });
      assert.match(syn.reply, /Excellent Match|Strong Match|Good Match/);
      assert.doesNotMatch(syn.reply, /score:\s*\d|confidence:\s*\d/i);
      assert.ok(['Excellent Match', 'Strong Match', 'Good Match'].includes(syn.overallConfidenceLabel));
      return syn.overallConfidenceLabel;
    })
  );

  results.push(
    caseResult('F9-05', 'F3_tradeoffs', 'Trade-offs explained for multi-college sets', () => {
      const syn = synthesizePersonalizedRecommendation({
        recommendedColleges: [
          { collegeName: 'Alpha', tier: 'best_match', fee: 100000 },
          { collegeName: 'Beta', tier: 'strong_alternative', fee: 200000 },
        ],
        recommendationReasons: {
          Alpha: { why: ['Strong course fit'], strengths: [], consider: [] },
          Beta: { why: ['Lower location friction'], strengths: [], consider: ['Higher fee'] },
        },
      });
      assert.match(syn.reply, /How they differ/i);
      assert.ok(syn.tradeoffs.length >= 2);
      return `${syn.tradeoffs.length} tradeoff lines`;
    })
  );

  results.push(
    caseResult('F9-06', 'F4_missing', 'Missing shortlist does not invent colleges', () => {
      const syn = synthesizePersonalizedRecommendation({ preferredCourse: 'B.Tech' });
      assert.equal(selectRankedRecommendations({}).length, 0);
      assert.equal(syn.items.length, 0);
      assert.doesNotMatch(syn.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);
      return 'empty-safe';
    })
  );

  results.push(
    await caseResultAsync('F5-07', 'F5_transition', 'Phase 9 → Phase 10 → Phase 11 → Phase 12 preserves rankings; no premature CTA', async () => {
      let r = await journeyToPhase9();
      r = await handleCareerCounsellingMessage('continue', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
      r = await handleCareerCounsellingMessage('continue', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
      r = await handleCareerCounsellingMessage('ready', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
      assert.doesNotMatch(r.reply, new RegExp(bookingPageUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(r.reply, /https?:\/\//i);
      return 'phase12-ok';
    })
  );

  results.push(
    await caseResultAsync('F9-08', 'F5_transition', 'Phase 9 soft-teases future; Phase 10 entered only on continue', async () => {
      const r = await journeyToPhase9();
      assert.match(r.reply, /future could look like/i);
      assert.equal(r.context.stage, STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION);
      assert.notEqual(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
      return 'teaser-only';
    })
  );

  results.push(
    caseResult('F9-09', 'F9_safety', 'No hallucinated brand colleges in synthesis', () => {
      const syn = synthesizePersonalizedRecommendation({
        recommendedColleges: [{ collegeName: 'Rayalaseema University College', tier: 'best_match' }],
      });
      assert.doesNotMatch(syn.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);
      return 'no-hallucination';
    })
  );

  results.push(
    caseResult('F9-10', 'F8_perf', 'Synthesis completes under 50ms (local)', () => {
      const t0 = Date.now();
      for (let i = 0; i < 100; i += 1) {
        synthesizePersonalizedRecommendation({
          preferredCollege: 'A',
          recommendedColleges: [
            { collegeName: 'A', tier: 'best_match' },
            { collegeName: 'B', tier: 'strong_alternative' },
            { collegeName: 'C', tier: 'worth_exploring' },
          ],
          recommendationReasons: {
            A: { why: ['fit'], strengths: [], consider: [] },
          },
          recommendationConfidence: 70,
        });
      }
      const avg = (Date.now() - t0) / 100;
      assert.ok(avg < 50, `avg ${avg}ms`);
      return `avg=${avg.toFixed(2)}ms`;
    })
  );

  results.push(
    caseResult('F9-11', 'F2_quality', 'Weak confidence note when signals thin', () => {
      const syn = synthesizePersonalizedRecommendation({
        recommendedColleges: [{ collegeName: 'Only', tier: 'worth_exploring' }],
        recommendationConfidence: 20,
      });
      assert.equal(overallConfidenceLabel({ recommendationConfidence: 20 }, syn.items), 'Good Match');
      assert.match(syn.reply, /Confidence is lower|decision support/i);
      return 'weak-note';
    })
  );

  setShortlistingEligibilityDeps({});

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const passRate = results.length ? pass / results.length : 0;
  const overall =
    fail === 0 && passRate >= PASS_GATE ? 'PASS' : fail === 0 ? 'PASS_WITH_WARNINGS' : 'FAIL';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    section: 'F-Phase9',
    title: 'Phase 9 Personalized Recommendation — Production Certification',
    mode: 'local_deterministic',
    architectureFinding:
      'Deterministic synthesis after concern_resolution; reuses shortlist/comparison/profile; no LLM; invitation CTA unchanged',
    summary: {
      total: results.length,
      pass,
      fail,
      passRate,
      gate: PASS_GATE,
      overall,
    },
    performance: {
      cases: results.map((r) => ({ id: r.id, durationMs: r.durationMs })),
    },
    results,
    failures: results.filter((r) => r.status === 'FAIL'),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `phase9-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `phase9-certification-${stamp}.md`);
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
