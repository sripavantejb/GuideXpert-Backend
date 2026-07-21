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
  if (opts.requireExamples && !/For example:.*placements/i.test(text)) {
    fails.push('missing_inline_examples');
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
    requireExamples: true,
    minLines: 3,
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

  auditInteractive('static:explore_header', EXPLORE_MESSAGES.present_header, {
    minLines: 1,
  });
  if (!/shortlist.*match|best match your goals|based on your goals/i.test(EXPLORE_MESSAGES.ask_continue)) {
    record('static:explore_ask', 'FAIL', { fails: ['missing_shortlist_question'] });
  } else {
    record('static:explore_ask', 'PASS', {});
  }

  if (CURATED_MODERN_CATALOG.length < 10 || EXPLORE_PRESENT_LIMIT !== 5) {
    record('static:top5_showcase', 'FAIL', {
      fails: [`catalog=${CURATED_MODERN_CATALOG.length},limit=${EXPLORE_PRESENT_LIMIT}`],
    });
  } else {
    record('static:top5_showcase', 'PASS', {});
  }

  const niatOnly = CURATED_MODERN_CATALOG.every((c) => /niat/i.test(c.id));
  if (niatOnly) record('static:equal_representation', 'FAIL', { fails: ['niat_only'] });
  else record('static:equal_representation', 'PASS', {});

  const traditionalPopularity = CURATED_MODERN_CATALOG.some((c) =>
    /\b(cbit|vasavi|griet|jntuh|jntu|mgit|cvr|sreenidhi|vnr|iiit|iit\b|nit\b|bits)\b/i.test(
      `${c.id} ${c.name}`
    )
  );
  if (traditionalPopularity) {
    record('static:new_age_not_popularity', 'FAIL', { fails: ['traditional_or_iit_iiit_nit'] });
  } else {
    record('static:new_age_not_popularity', 'PASS', {});
  }

  const niatIndex = CURATED_MODERN_CATALOG.findIndex((c) => /niat/i.test(c.id));
  if (niatIndex <= 0 || niatIndex === CURATED_MODERN_CATALOG.length - 1) {
    record('static:niat_mid_list', 'FAIL', { fails: [`niatIndex=${niatIndex}`] });
  } else {
    record('static:niat_mid_list', 'PASS', { niatIndex });
  }

  if (
    !/new-age institutions|industry-integrated|project-based|future-ready/i.test(
      EXPLORE_MESSAGES.present_header
    )
  ) {
    record('static:explore_header_philosophy', 'FAIL', { fails: ['missing_new_age_framing'] });
  } else {
    record('static:explore_header_philosophy', 'PASS', {});
  }
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
    auditInteractive('live:stage3_ask', r.reply, { requireQuestion: true, requireExamples: true, minLines: 4 });
  }

  r = await handleCareerCounsellingMessage('placements and coding culture', r.context);
  auditInteractive('live:stage3_expand', r.reply, {
    requireQuestion: true,
    requirePrioritiesSection: true,
    requireAdditionalSection: true,
    minLines: 8,
  });

  // Condensed Stage 4 bridge (not the old multi-step lecture)
  r = await handleCareerCounsellingMessage('yes', r.context);
  if (r.context?.stage !== 'modern_colleges' || r.context?.step !== 'modern_condensed') {
    record('live:stage4_condensed', 'FAIL', {
      fails: [`stage=${r.context?.stage},step=${r.context?.step}`],
    });
  } else {
    auditInteractive('live:stage4_condensed', r.reply, {
      requireQuestion: true,
      minLines: 5,
    });
    if (!/Industry projects|Mentorship|Internships/i.test(r.reply)) {
      record('live:stage4_bullets', 'FAIL', { fails: ['missing_emphasis_bullets'] });
    } else {
      record('live:stage4_bullets', 'PASS', {});
    }
  }

  r = await handleCareerCounsellingMessage('yes', r.context);
  if (r.context?.stage !== 'explore_modern_colleges') {
    record('live:stage5_explore', 'FAIL', { fails: [`stage=${r.context?.stage}`] });
  } else {
    const count = (r.context.profile?.exploreModernInstitutions || []).length;
    if (count !== 5) record('live:stage5_showcase', 'FAIL', { fails: [`count=${count}`] });
    else record('live:stage5_showcase', 'PASS', { count });
    auditInteractive('live:stage5_ask_shortlist', r.reply, { requireQuestion: true, minLines: 5 });
  }

  r = await handleCareerCounsellingMessage('yes', r.context);
  if (r.context?.stage !== 'personalized_discovery') {
    record('live:stage6_personalization', 'FAIL', { fails: [`stage=${r.context?.stage}`] });
  } else if (r.context?.step !== 'pers_budget') {
    record('live:stage6_personalization', 'FAIL', { fails: [`step=${r.context?.step}`] });
  } else if ((r.context.profile?.stage5PreviewInstitutions || []).length !== 3) {
    record('live:stage6_personalization', 'FAIL', { fails: ['missing_top3_preview'] });
  } else {
    record('live:stage6_personalization', 'PASS', {});
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
