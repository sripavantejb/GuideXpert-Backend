'use strict';

/**
 * Phase 11 Final Decision Hesitation — local production certification (deterministic).
 * Run: node scripts/phase11ProductionCertification.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  STAGES,
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  classifyHesitation,
  buildPersonalizedHesitationReply,
  evaluatePhase11Escalation,
  buildOneOnOneEscalationReply,
  ONE_ON_ONE_SESSION_URL,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2FinalDecisionHesitationCore');
const {
  setShortlistingEligibilityDeps,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
const { bookingPageUrl } = require('../services/chatbot/bookingContext/bookingContextResolver');
const {
  GUARANTEE_FORBIDDEN,
} = require('../constants/careerCounsellingV2FinalDecisionHesitation');

const OUT_DIR = path.join(__dirname, '..', 'smoke-results', 'sectionF');
const PASS_GATE = Number(process.env.PHASE11_PASS_GATE || 1);

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

async function journeyToPhase11() {
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

function sampleProfile() {
  return {
    preferredCourse: 'B.Tech',
    careerGoal: 'Software engineer',
    learningStyle: 'hands-on projects',
    phase9Recommendations: [
      { collegeName: 'Hyderabad Tech University', rankLabel: 'Best Match', confidence: 'high' },
    ],
    recommendedColleges: [
      { collegeName: 'Hyderabad Tech University', tier: 'best_match' },
      { collegeName: 'Andhra Engineering College', tier: 'strong_alternative' },
    ],
    resolvedConcerns: ['fees', 'wrong branch'],
  };
}

async function main() {
  setShortlistingEligibilityDeps({
    fetchCollegeDostColleges: async () => ({
      colleges: mockColleges,
      total_no_of_colleges: mockColleges.length,
    }),
  });

  const results = [];
  const bookingRe = new RegExp(bookingPageUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  results.push(
    await caseResultAsync('P11-01', 'entry', 'Enters from Phase 10 continue', async () => {
      const r = await journeyToPhase11();
      assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
      assert.equal(r.context.step, 'hesitation_ask');
      assert.equal(r.context.profile.phase11HesitationPresented, true);
      return 'entered';
    })
  );

  const taxonomyCases = [
    ['P11-02', 'decision_uncertainty', 'I am still unsure about deciding'],
    ['P11-03', 'parent_alignment', 'parents may not agree'],
    ['P11-04', 'wrong_choice_fear', 'what if I choose wrong'],
    ['P11-05', 'academic_manageability', 'too hard academically'],
    ['P11-06', 'fit_confidence', 'is this the right path for me'],
  ];

  for (const [id, expectedId, utterance] of taxonomyCases) {
    results.push(
      await caseResultAsync(id, 'taxonomy', `${expectedId} personalized reply`, async () => {
        let r = await journeyToPhase11();
        const ranksBefore = JSON.stringify(r.context.profile.recommendedColleges);
        r = await handleCareerCounsellingMessage(utterance, r.context);
        assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
        assert.equal(r.context.step, 'hesitation_confirm');
        assert.equal(r.context.currentHesitationId || r.context.profile.phase11LastHesitationId, expectedId);
        assert.match(r.reply, /Does that help|more confident/i);
        assert.doesNotMatch(r.reply, bookingRe);
        assert.doesNotMatch(r.reply, /\bcounsellor\b|\bcounselor\b|\bbook(ing)?\b/i);
        assert.equal(JSON.stringify(r.context.profile.recommendedColleges), ranksBefore);
        return expectedId;
      })
    );
  }

  results.push(
    await caseResultAsync('P11-07', 'transition', 'Fast path (no hesitation) → Phase 12 service selection', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('ready', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
      assert.equal(r.context.profile.phase11ConfidenceCheck, 'ready');
      assert.equal(
        r.context.profile.phase11ExitTarget,
        'phase_12_personalized_counseling_recommendation'
      );
      assert.doesNotMatch(r.reply, bookingRe);
      assert.doesNotMatch(r.reply, /https?:\/\//i);
      return 'phase12-handoff';
    })
  );

  results.push(
    await caseResultAsync('P11-08', 'transition', 'Confirm YES → Phase 12', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('I am still unsure about deciding', r.context);
      r = await handleCareerCounsellingMessage('yes', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
      assert.equal(r.context.profile.phase11ConfidenceCheck, 'yes');
      assert.ok(r.context.profile.phase11ResolvedHesitations.includes('decision_uncertainty'));
      assert.doesNotMatch(r.reply, bookingRe);
      return 'yes-exit-phase12';
    })
  );

  results.push(
    await caseResultAsync('P11-09', 'transition', 'Confirm NO → one more reply then escalate (no long loop)', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('parents may not agree', r.context);
      r = await handleCareerCounsellingMessage('no', r.context);
      assert.equal(r.context.step, 'hesitation_second');
      r = await handleCareerCounsellingMessage('fear of wrong choice', r.context);
      assert.equal(r.context.step, 'hesitation_escalation');
      assert.equal(r.context.profile.phase11Escalated, true);
      assert.match(r.reply, new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(r.reply, bookingRe);
      assert.notEqual(r.context.stage, STAGES.CONCERN_RESOLUTION);
      return 'escalate-after-repeated';
    })
  );

  results.push(
    await caseResultAsync('P11-10', 'negative', 'Does not restart Phase 7', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('start over and re-evaluate my concerns', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
      assert.notEqual(r.context.stage, STAGES.CONCERN_RESOLUTION);
      assert.match(r.reply, /won.?t reopen evaluation|already covered/i);
      return 'no-phase7';
    })
  );

  results.push(
    await caseResultAsync('P11-11', 'negative', 'Does not regenerate recommendations', async () => {
      let r = await journeyToPhase11();
      const before = JSON.stringify(r.context.profile.phase9Recommendations);
      r = await handleCareerCounsellingMessage('I am still unsure about deciding', r.context);
      assert.equal(JSON.stringify(r.context.profile.phase9Recommendations), before);
      assert.doesNotMatch(r.reply, /Best Match:|Strong Alternative:|Good Backup:/i);
      return 'no-regen';
    })
  );

  results.push(
    await caseResultAsync('P11-12', 'negative', 'Does not compare colleges', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('compare the colleges again', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
      assert.match(r.reply, /not comparing/i);
      return 'no-compare';
    })
  );

  results.push(
    await caseResultAsync('P11-13', 'negative', 'Does not mutate recommendedColleges order', async () => {
      let r = await journeyToPhase11();
      const before = JSON.stringify(r.context.profile.recommendedColleges);
      r = await handleCareerCounsellingMessage('ready', r.context);
      assert.equal(JSON.stringify(r.context.profile.recommendedColleges), before);
      return 'order-intact';
    })
  );

  results.push(
    await caseResultAsync('P11-14', 'negative', 'Does not mutate recommendation reasons / confidence', async () => {
      let r = await journeyToPhase11();
      const before = JSON.stringify(
        (r.context.profile.phase9Recommendations || []).map((x) => ({
          collegeName: x.collegeName,
          rankLabel: x.rankLabel,
          confidence: x.confidence,
        }))
      );
      r = await handleCareerCounsellingMessage('is this the right path', r.context);
      r = await handleCareerCounsellingMessage('yes', r.context);
      const after = JSON.stringify(
        (r.context.profile.phase9Recommendations || []).map((x) => ({
          collegeName: x.collegeName,
          rankLabel: x.rankLabel,
          confidence: x.confidence,
        }))
      );
      assert.equal(after, before);
      return 'reasons-intact';
    })
  );

  results.push(
    await caseResultAsync('P11-15', 'negative', 'Default hesitation reply does not pitch counseling', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('I am still unsure about deciding', r.context);
      assert.doesNotMatch(r.reply, /One-on-One|expert counselors|optional counsellor/i);
      assert.doesNotMatch(r.reply, new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
      return 'no-early-counsel-pitch';
    })
  );

  results.push(
    await caseResultAsync('P11-16', 'escalation', 'Expert/book request uses only official One-on-One URL', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('Can I book a counsellor now?', r.context);
      assert.equal(r.context.step, 'hesitation_escalation');
      assert.equal(r.context.profile.phase11Escalated, true);
      assert.match(r.reply, new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(r.reply, bookingRe);
      assert.doesNotMatch(r.reply, /iit-counselling/i);
      return 'official-ooo-url';
    })
  );

  results.push(
    await caseResultAsync('P11-17', 'negative', 'Does not perform human WhatsApp handoff', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('connect me to a human expert', r.context);
      assert.equal(r.context.profile.phase11Escalated, true);
      assert.notEqual(r.context.profile?.handoffReason, 'human_copilot');
      assert.doesNotMatch(r.reply, /transfer(ring)? you|live agent/i);
      assert.match(r.reply, new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return 'no-whatsapp-handoff';
    })
  );

  results.push(
    caseResult('P11-18', 'negative', 'No guarantee / pressure language', () => {
      for (const id of [
        'decision_uncertainty',
        'parent_alignment',
        'wrong_choice_fear',
        'academic_manageability',
        'fit_confidence',
      ]) {
        const built = buildPersonalizedHesitationReply(sampleProfile(), id);
        for (const re of GUARANTEE_FORBIDDEN) {
          assert.doesNotMatch(built.reply, re);
        }
        assert.doesNotMatch(built.reply, /\byou have to\b|\bmust decide now\b/i);
      }
      assert.equal(classifyHesitation('still unsure').id, 'decision_uncertainty');
      return 'guardrails-ok';
    })
  );

  results.push(
    caseResult('P11-19', 'perf', 'Hesitation render under 50ms avg', () => {
      const profile = sampleProfile();
      const t0 = Date.now();
      for (let i = 0; i < 100; i += 1) {
        buildPersonalizedHesitationReply(profile, 'decision_uncertainty');
      }
      const avg = (Date.now() - t0) / 100;
      assert.ok(avg < 50, `avg ${avg}`);
      return `avg=${avg.toFixed(2)}ms`;
    })
  );

  results.push(
    await caseResultAsync('P11-20', 'escalation', 'Repeated unresolved hesitation recommends One-on-One', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('I am still unsure about deciding', r.context);
      r = await handleCareerCounsellingMessage('no', r.context);
      r = await handleCareerCounsellingMessage('parents may not agree', r.context);
      assert.equal(r.context.profile.phase11Escalated, true);
      assert.equal(r.context.step, 'hesitation_escalation');
      assert.match(r.reply, /expert counselors|One-on-One Counseling Session/i);
      assert.match(r.reply, new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return 'repeated-escalate';
    })
  );

  results.push(
    await caseResultAsync('P11-21', 'escalation', 'Single resolved hesitation does not escalate', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('I am still unsure about deciding', r.context);
      r = await handleCareerCounsellingMessage('yes', r.context);
      assert.equal(r.context.profile.phase11Escalated, false);
      assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
      assert.doesNotMatch(r.reply, new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return 'no-unnecessary-escalate';
    })
  );

  results.push(
    await caseResultAsync('P11-22', 'escalation', 'Explicit expert request → official form only', async () => {
      let r = await journeyToPhase11();
      r = await handleCareerCounsellingMessage('I want to speak with an expert counselor', r.context);
      assert.equal(r.context.profile.phase11EscalationReason, 'explicit_expert_request');
      assert.match(r.reply, new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(r.reply, bookingRe);
      return 'explicit-expert';
    })
  );

  results.push(
    await caseResultAsync('P11-23', 'escalation', 'Escalation never mutates prior recommendations', async () => {
      let r = await journeyToPhase11();
      const ranksBefore = JSON.stringify(r.context.profile.recommendedColleges);
      const reasonsBefore = JSON.stringify(r.context.profile.phase9Recommendations);
      r = await handleCareerCounsellingMessage('I want to speak with an expert counselor', r.context);
      assert.equal(r.context.profile.phase11Escalated, true);
      assert.equal(JSON.stringify(r.context.profile.recommendedColleges), ranksBefore);
      assert.equal(JSON.stringify(r.context.profile.phase9Recommendations), reasonsBefore);
      return 'rankings-intact';
    })
  );

  results.push(
    caseResult('P11-24', 'escalation', 'Escalation copy only shares official One-on-One URL', () => {
      const built = buildOneOnOneEscalationReply(sampleProfile(), {
        escalate: true,
        reason: 'repeated_unresolved_hesitation',
      });
      assert.match(built.reply, new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(built.reply, /iit-counselling|guaranteed|must book|act now/i);
      const decision = evaluatePhase11Escalation({
        profile: {
          phase11ConfidenceCheck: 'yes',
          phase11PersonalizedResponseCount: 1,
          phase11RaisedHesitations: ['decision_uncertainty'],
          phase11ConfidenceNoCount: 0,
          phase11ReassuranceAskCount: 0,
          phase11MultiTopicUtterance: false,
        },
      });
      assert.equal(decision.escalate, false);
      return 'url-and-threshold-ok';
    })
  );

  setShortlistingEligibilityDeps({});

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const passRate = results.length ? pass / results.length : 0;
  const overall = fail === 0 && passRate >= PASS_GATE ? 'PASS' : 'FAIL';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    section: 'F-Phase11',
    title: 'Phase 11 Final Decision Hesitation — Production Certification',
    mode: 'local_deterministic',
    summary: { total: results.length, pass, fail, passRate, gate: PASS_GATE, overall },
    results,
    failures: results.filter((r) => r.status === 'FAIL'),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `phase11-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `phase11-certification-${stamp}.md`);
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
