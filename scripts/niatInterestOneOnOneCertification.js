'use strict';

/**
 * NIAT interest → One-on-One Counseling — local production certification.
 * Run: node scripts/niatInterestOneOnOneCertification.js
 *
 * Separate funnel from Phase 11 objection escalation.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  STAGES,
  handleCareerCounsellingMessage,
  detectNiatInterest,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  ONE_ON_ONE_SESSION_URL,
  NIAT_INTEREST_STAGE,
  assertNiatTransitionGuardrails,
  buildNiatInterestOneOnOneResult,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2NiatInterestService');
const { bookingPageUrl } = require('../services/chatbot/bookingContext/bookingContextResolver');
const {
  buildNiatOneOnOneReply,
} = require('../constants/careerCounsellingV2NiatInterest');

const OUT_DIR = path.join(__dirname, '..', 'smoke-results', 'sectionF');
const PASS_GATE = Number(process.env.NIAT_INTEREST_PASS_GATE || 1);
const oooRe = new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const bookingRe = new RegExp(bookingPageUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

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
  const results = [];

  const positiveUtterances = [
    ['NIAT-01', 'I want to join NIAT.'],
    ['NIAT-02', "I'm interested in NIAT."],
    ['NIAT-03', 'How do I take admission in NIAT?'],
    ['NIAT-04', 'Can I get into NIAT?'],
    ['NIAT-05', 'Tell me about joining NIAT.'],
    ['NIAT-06', 'I think NIAT is the right choice.'],
  ];

  for (const [id, utterance] of positiveUtterances) {
    results.push(
      await caseResultAsync(id, 'positive', `Detects interest: ${utterance}`, async () => {
        assert.equal(detectNiatInterest(utterance).matched, true);
        const r = await handleCareerCounsellingMessage(utterance, {}, { isNewEntry: true });
        assert.equal(r.context.stage, NIAT_INTEREST_STAGE);
        assert.equal(r.context.profile.niatInterestDetected, true);
        assert.equal(r.context.profile.niatInterestFunnel, 'niat_interest');
        assert.match(r.reply, oooRe);
        assert.doesNotMatch(r.reply, bookingRe);
        assert.doesNotMatch(r.reply, /guaranteed|mandatory|must book/i);
        return 'ooo';
      })
    );
  }

  const negativeUtterances = [
    ['NIAT-07', 'What is NIAT?'],
    ['NIAT-08', 'Tell me about NIAT'],
    ['NIAT-09', 'Compare NIAT vs other colleges'],
    ['NIAT-10', 'Which is better NIAT or traditional college?'],
  ];

  for (const [id, utterance] of negativeUtterances) {
    results.push(
      caseResult(id, 'negative', `Does not trigger: ${utterance}`, () => {
        assert.equal(detectNiatInterest(utterance).matched, false);
        return 'skipped';
      })
    );
  }

  results.push(
    await caseResultAsync('NIAT-11', 'negative', 'Mere NIAT mention in discovery does not jump to OOO', async () => {
      let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
      r = await handleCareerCounsellingMessage('What is NIAT?', r.context);
      assert.notEqual(r.context.stage, NIAT_INTEREST_STAGE);
      assert.doesNotMatch(r.reply || '', oooRe);
      return 'no-false-positive';
    })
  );

  results.push(
    caseResult('NIAT-12', 'guardrail', 'Copy only uses official One-on-One URL', () => {
      const reply = buildNiatOneOnOneReply();
      assertNiatTransitionGuardrails(reply);
      assert.match(reply, oooRe);
      assert.doesNotMatch(reply, /iit-counselling|guaranteed|mandatory/i);
      return 'url-ok';
    })
  );

  results.push(
    caseResult('NIAT-13', 'analytics', 'Funnel distinct from Phase 11 escalation', () => {
      const built = buildNiatInterestOneOnOneResult(
        { stage: STAGES.DISCOVERY || 'discovery', profile: {} },
        { matched: true, reason: 'explicit_interest' }
      );
      assert.equal(built.context.profile.niatInterestFunnel, 'niat_interest');
      assert.ok(built.analytics.some((a) => a.type === 'niat_interest_detected'));
      assert.ok(
        built.analytics.some((a) => a.type === 'one_on_one_recommended' && a.source === 'niat_interest')
      );
      assert.ok(!built.analytics.some((a) => a.source === 'phase11_hesitation'));
      return 'funnel-separated';
    })
  );

  results.push(
    await caseResultAsync('NIAT-14', 'transition', 'Immediate transition mid-journey', async () => {
      let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
      r = await handleCareerCounsellingMessage('Class 12', r.context);
      r = await handleCareerCounsellingMessage('I want to join NIAT', r.context);
      assert.equal(r.context.stage, NIAT_INTEREST_STAGE);
      assert.match(r.reply, /interested in NIAT/i);
      assert.match(r.reply, oooRe);
      return 'immediate';
    })
  );

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const passRate = results.length ? pass / results.length : 0;
  const overall = fail === 0 && passRate >= PASS_GATE ? 'PASS' : 'FAIL';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    section: 'F-NiatInterest',
    title: 'NIAT Interest → One-on-One Counseling — Production Certification',
    mode: 'local_deterministic',
    summary: { total: results.length, pass, fail, passRate, gate: PASS_GATE, overall },
    results,
    failures: results.filter((r) => r.status === 'FAIL'),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `niat-interest-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `niat-interest-certification-${stamp}.md`);
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
