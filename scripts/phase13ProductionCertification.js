'use strict';

/**
 * Phase 13 Booking Orchestrator — local production certification.
 * Run: node scripts/phase13ProductionCertification.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  STAGES,
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  BOOKING_SERVICE_REGISTRY,
  buildOfficialBookingUrl,
  shouldSkipPhase13,
  resolveBookingDestination,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2BookingOrchestratorCore');
const {
  startBookingOrchestrator,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2BookingOrchestratorEngine');
const {
  setShortlistingEligibilityDeps,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');

const OUT_DIR = path.join(__dirname, '..', 'smoke-results', 'sectionF');
const PASS_GATE = Number(process.env.PHASE13_PASS_GATE || 1);

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

async function journeyToPhase13() {
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
    caseResult('P13-01', 'registry', 'Registry maps all bookable services', () => {
      for (const key of ['one_on_one', 'admission', 'career']) {
        assert.ok(BOOKING_SERVICE_REGISTRY[key]);
        const url = buildOfficialBookingUrl(BOOKING_SERVICE_REGISTRY[key]);
        assert.equal(url, 'https://www.guidexpert.co.in/one-on-one-session');
      }
      assert.equal(BOOKING_SERVICE_REGISTRY.none, undefined);
      return 'registry-ok';
    })
  );

  results.push(
    await caseResultAsync('P13-02', 'entry', 'Phase 12 continue → booking URL immediately', async () => {
      const r = await journeyToPhase13();
      assert.equal(r.context.stage, STAGES.PHASE_13_BOOKING_ORCHESTRATOR);
      assert.equal(r.context.step, 'booking_presented');
      assert.ok(r.context.profile.phase13Service);
      assert.equal(r.context.profile.phase13CtaPresented, true);
      assert.equal(r.context.profile.phase13UrlShared, true);
      assert.match(r.reply, /https:\/\/www\.guidexpert\.co\.in\/one-on-one-session/);
      assert.match(r.reply, /1-on-1 Career Counseling|Done/i);
      assert.doesNotMatch(r.reply, /Wonderful\.|Booking happens on the GuideXpert website/i);
      return r.context.profile.phase13Service;
    })
  );

  results.push(
    await caseResultAsync('P13-03', 'url_timing', 'First positive reply already shared registry URL', async () => {
      let r = await journeyToPhase13();
      const expected = r.context.profile.phase13BookingUrl;
      assert.ok(expected);
      assert.equal(r.context.step, 'booking_presented');
      assert.match(r.reply, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(r.context.profile.phase13UrlShared, true);
      return 'url-on-first-positive';
    })
  );

  results.push(
    await caseResultAsync('P13-04', 'qa', 'Booking question after URL stays in Phase 13', async () => {
      let r = await journeyToPhase13();
      assert.equal(r.context.step, 'booking_presented');
      r = await handleCareerCounsellingMessage('How does booking work?', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_13_BOOKING_ORCHESTRATOR);
      assert.ok(r.context.step === 'booking_presented' || r.context.step === 'booking_confirmed');
      return 'qa-after-url';
    })
  );

  results.push(
    await caseResultAsync('P13-05', 'defer', 'Later completes via Phase 14 without URL', async () => {
      let r = await journeyToPhase13();
      r = await handleCareerCounsellingMessage('Later', r.context);
      assert.equal(r.context.stage, STAGES.JOURNEY_COMPLETED || 'journey_completed');
      assert.equal(r.context.profile.journeyOutcome, 'booking_deferred');
      assert.equal(r.context.profile.journeyCompleted, true);
      assert.ok(r.context.profile.platformHandoffPayload);
      assert.doesNotMatch(r.reply, /https?:\/\//i);
      return 'deferred';
    })
  );

  results.push(
    await caseResultAsync('P13-05b', 'engagement', 'Done after URL stays engaged (not journey_completed)', async () => {
      let r = await journeyToPhase13();
      assert.equal(r.context.step, 'booking_presented');
      assert.match(r.reply, /1-on-1 Career Counseling|Done/i);
      r = await handleCareerCounsellingMessage('Done', r.context);
      assert.equal(r.context.stage, STAGES.PHASE_13_BOOKING_ORCHESTRATOR);
      assert.equal(r.context.step, 'booking_confirmed');
      assert.notEqual(r.context.profile.journeyCompleted, true);
      assert.match(r.reply, /Perfect!|booking request has been received|still here to help/i);
      return 'done-stays-engaged';
    })
  );

  results.push(
    await caseResultAsync('P13-06', 'resume', 'Send booking link resumes after Phase 14 defer', async () => {
      let r = await journeyToPhase13();
      r = await handleCareerCounsellingMessage('Later', r.context);
      assert.equal(r.context.profile.journeyCompleted, true);
      const rankings = JSON.stringify(r.context.profile.recommendedColleges);
      r = await handleCareerCounsellingMessage('Send booking link', r.context);
      assert.equal(r.context.step, 'booking_presented');
      assert.match(r.reply, /https?:\/\//i);
      assert.equal(JSON.stringify(r.context.profile.recommendedColleges), rankings);
      return 'resume-ok';
    })
  );

  results.push(
    caseResult('P13-07', 'skip', 'Skip when service is none → Phase 14 information_only', () => {
      assert.equal(shouldSkipPhase13({ phase12Service: 'none' }).skip, true);
      const started = startBookingOrchestrator({
        profile: { phase12Service: 'none' },
      });
      assert.equal(started.context.stage, 'journey_completed');
      assert.equal(started.context.profile.journeyOutcome, 'information_only');
      assert.doesNotMatch(started.reply, /https?:\/\//i);
      return 'skip-none';
    })
  );

  results.push(
    caseResult('P13-08', 'skip', 'Skip when Phase 11 escalated', () => {
      assert.equal(shouldSkipPhase13({ phase12Service: 'one_on_one', phase11Escalated: true }).skip, true);
      return 'skip-p11';
    })
  );

  results.push(
    caseResult('P13-09', 'skip', 'Skip when NIAT OOO already offered', () => {
      assert.equal(
        shouldSkipPhase13({ phase12Service: 'admission', niatOneOnOneRecommended: true }).skip,
        true
      );
      return 'skip-niat';
    })
  );

  results.push(
    caseResult('P13-10', 'routing', 'Admission and career resolve to official form URL', () => {
      const adm = resolveBookingDestination({ phase12Service: 'admission' });
      const car = resolveBookingDestination({ phase12Service: 'career' });
      assert.equal(adm.ok, true);
      assert.equal(car.ok, true);
      assert.equal(adm.url, 'https://www.guidexpert.co.in/one-on-one-session');
      assert.equal(car.url, 'https://www.guidexpert.co.in/one-on-one-session');
      return 'official-form';
    })
  );

  results.push(
    await caseResultAsync('P13-11', 'negative', 'Does not mutate rankings on Book Now', async () => {
      let r = await journeyToPhase13();
      const before = JSON.stringify(r.context.profile.recommendedColleges);
      const phase9 = JSON.stringify(r.context.profile.phase9Recommendations);
      r = await handleCareerCounsellingMessage('Book now', r.context);
      assert.equal(JSON.stringify(r.context.profile.recommendedColleges), before);
      assert.equal(JSON.stringify(r.context.profile.phase9Recommendations), phase9);
      return 'immutable';
    })
  );

  results.push(
    await caseResultAsync('P13-12', 'negative', 'Does not restart Phase 12 on booking question', async () => {
      let r = await journeyToPhase13();
      r = await handleCareerCounsellingMessage('Why book on the website?', r.context);
      assert.notEqual(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
      assert.ok(
        r.context.step === 'booking_presented' || r.context.step === 'booking_confirmed'
      );
      return 'no-phase12-restart';
    })
  );

  results.push(
    caseResult('P13-13', 'guardrail', 'URL built only from registry entry', () => {
      const entry = BOOKING_SERVICE_REGISTRY.one_on_one;
      const url = buildOfficialBookingUrl(entry);
      assert.equal(url, entry.baseUrl.split('?')[0]);
      assert.equal(url, 'https://www.guidexpert.co.in/one-on-one-session');
      return 'registry-only';
    })
  );

  setShortlistingEligibilityDeps({});

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const passRate = results.length ? pass / results.length : 0;
  const overall = fail === 0 && passRate >= PASS_GATE ? 'PASS' : 'FAIL';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    section: 'F-Phase13',
    title: 'Phase 13 Booking Orchestrator — Production Certification',
    mode: 'local_deterministic',
    summary: { total: results.length, pass, fail, passRate, gate: PASS_GATE, overall },
    results,
    failures: results.filter((r) => r.status === 'FAIL'),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `phase13-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `phase13-certification-${stamp}.md`);
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
