#!/usr/bin/env node
'use strict';

/**
 * Educational / Interactive Framework Content Certification — Phases 3–5.
 * Validates interactive counseling pattern (not lecture chain).
 *
 *   node scripts/educationalContentCertification.js
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  MESSAGES: EVAL_MESSAGES,
  buildFrameworkExpandMessage,
} = require('../constants/careerCounsellingV2Evaluation');
const {
  MESSAGES: EXPLORE_MESSAGES,
  CURATED_MODERN_CATALOG,
  EXPLORE_PRESENT_LIMIT,
} = require('../constants/careerCounsellingV2ExploreModernColleges');
const { nonEmptyLines } = require('../services/chatbot/careerCounselling/careerCounsellingV2ResponseOptimizer');
const {
  extractAdvanceQuestion,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2PhaseOrchestrator');

const OUT_DIR = path.join(__dirname, '..', 'smoke-results', 'counseling');

const FORBIDDEN_ENDINGS = [
  /anything else\??/i,
  /what else\??/i,
  /how can i help\??/i,
  /what would you like to know next\??/i,
];

const report = {
  startedAt: new Date().toISOString(),
  audits: [],
  passed: 0,
  failed: 0,
  failures: [],
};

function record(name, status, detail = {}) {
  const row = { name, status, ...detail };
  report.audits.push(row);
  if (status === 'PASS') report.passed += 1;
  else {
    report.failed += 1;
    report.failures.push(row);
  }
}

function auditInteractive(label, text, opts = {}) {
  const fails = [];
  const lines = nonEmptyLines(text);
  for (const re of FORBIDDEN_ENDINGS) {
    if (re.test(text)) fails.push(`forbidden_ending:${re.source}`);
  }
  if (opts.requireQuestion && !extractAdvanceQuestion(text)) {
    fails.push('missing_transition');
  }
  if (opts.requirePrioritiesSection && !/\*Your Priorities\*/i.test(text)) {
    fails.push('missing_priorities_section');
  }
  if (opts.requireAdditionalSection && !/Additional Factors/i.test(text)) {
    fails.push('missing_additional_section');
  }
  if (opts.minLines && lines.length < opts.minLines) {
    fails.push(`too_short:${lines.length}`);
  }
  if (fails.length) record(label, 'FAIL', { fails, preview: lines.slice(0, 3).join(' | ') });
  else record(label, 'PASS', { lineCount: lines.length });
}

function staticAudit() {
  auditInteractive('static:ask_priorities', EVAL_MESSAGES.ask_priorities, {
    requireQuestion: true,
    minLines: 4,
  });
  const expand = buildFrameworkExpandMessage({
    studentPriorities: ['Placements', 'Internships'],
  });
  auditInteractive('static:framework_expand', expand, {
    requireQuestion: true,
    requirePrioritiesSection: true,
    requireAdditionalSection: true,
    minLines: 8,
  });
  const priIdx = expand.indexOf('Your Priorities');
  const addIdx = expand.indexOf('Additional Factors');
  if (priIdx < 0 || addIdx < 0 || priIdx >= addIdx) {
    record('static:sections_separated', 'FAIL', { fails: ['sections_not_separated'] });
  } else {
    record('static:sections_separated', 'PASS', {});
  }

  auditInteractive('static:explore_intro', EXPLORE_MESSAGES.intro, {
    minLines: 3,
  });
  if (!/narrow|personal goals|preferences/i.test(EXPLORE_MESSAGES.ask_continue)) {
    record('static:explore_ask', 'FAIL', { fails: ['missing_narrow_question'] });
  } else {
    record('static:explore_ask', 'PASS', {});
  }

  if (CURATED_MODERN_CATALOG.length < 10 || EXPLORE_PRESENT_LIMIT !== 10) {
    record('static:top10', 'FAIL', {
      fails: [`catalog=${CURATED_MODERN_CATALOG.length},limit=${EXPLORE_PRESENT_LIMIT}`],
    });
  } else {
    record('static:top10', 'PASS', {});
  }

  const niatOnly = CURATED_MODERN_CATALOG.every((c) => /niat/i.test(c.id));
  if (niatOnly) record('static:equal_representation', 'FAIL', { fails: ['niat_only'] });
  else record('static:equal_representation', 'PASS', {});
}

async function liveAudit() {
  let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
  r = await handleCareerCounsellingMessage('Class 12', r.context);
  r = await handleCareerCounsellingMessage('B.Tech', r.context);
  r = await handleCareerCounsellingMessage('Software engineer', r.context);
  r = await handleCareerCounsellingMessage('not yet', r.context);
  r = await handleCareerCounsellingMessage('English', r.context);

  if (r.context?.step !== 'eval_ask_priorities') {
    record('live:stage3_ask', 'FAIL', { fails: [`step=${r.context?.step}`] });
  } else {
    auditInteractive('live:stage3_ask', r.reply, { requireQuestion: true, minLines: 4 });
  }

  r = await handleCareerCounsellingMessage('placements and coding culture', r.context);
  auditInteractive('live:stage3_expand', r.reply, {
    requireQuestion: true,
    requirePrioritiesSection: true,
    requireAdditionalSection: true,
    minLines: 8,
  });

  // Must not be modern lecture
  if (r.context?.stage === 'modern_colleges') {
    record('live:skip_modern_lecture', 'FAIL', { fails: ['entered_modern'] });
  } else {
    record('live:skip_modern_lecture', 'PASS', {});
  }

  r = await handleCareerCounsellingMessage('yes', r.context);
  if (r.context?.stage !== 'explore_modern_colleges') {
    record('live:stage4_explore', 'FAIL', { fails: [`stage=${r.context?.stage}`] });
  } else {
    const count = (r.context.profile?.exploreModernInstitutions || []).length;
    if (count < 8) record('live:stage4_top10', 'FAIL', { fails: [`count=${count}`] });
    else record('live:stage4_top10', 'PASS', { count });
    auditInteractive('live:stage4_ask_narrow', r.reply, { requireQuestion: true, minLines: 5 });
  }

  r = await handleCareerCounsellingMessage('yes', r.context);
  if (r.context?.stage !== 'personalized_discovery') {
    record('live:stage5_personalization', 'FAIL', { fails: [`stage=${r.context?.stage}`] });
  } else {
    record('live:stage5_personalization', 'PASS', {});
  }
}

function writeReport() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  report.finishedAt = new Date().toISOString();
  report.verdict = report.failed === 0 ? 'PASS' : 'FAIL';
  report.educationalQualityPassPct =
    report.passed + report.failed === 0
      ? 0
      : Math.round((report.passed / (report.passed + report.failed)) * 100);

  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(OUT_DIR, `educational-content-${stamp}.json`), json);
  fs.writeFileSync(path.join(OUT_DIR, 'educational-content-latest.json'), json);
  const md = [
    '# Educational / Interactive Framework Certification',
    '',
    `- Verdict: **${report.verdict}**`,
    `- Quality: **${report.educationalQualityPassPct}%**`,
    `- Passed: ${report.passed} Failed: ${report.failed}`,
    '',
    '## Failures',
    report.failures.length
      ? report.failures.map((f) => `- ${f.name}: ${(f.fails || []).join(', ')}`).join('\n')
      : '_None_',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, `educational-content-${stamp}.md`), md);
  fs.writeFileSync(path.join(OUT_DIR, 'educational-content-latest.md'), md);
  return path.join(OUT_DIR, `educational-content-${stamp}.md`);
}

async function main() {
  console.log('EDUCATIONAL / INTERACTIVE FRAMEWORK CERT — Phases 3–5');
  staticAudit();
  await liveAudit();
  const mdPath = writeReport();
  console.log('────────────────────────────────────────');
  console.log(
    `Passed=${report.passed} Failed=${report.failed} Quality=${report.educationalQualityPassPct}%`
  );
  console.log(`Verdict: ${report.verdict === 'PASS' ? '100% Educational Quality Pass' : 'FAIL'}`);
  console.log(`Report: ${mdPath}`);
  console.log('────────────────────────────────────────');
  process.exit(report.failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
