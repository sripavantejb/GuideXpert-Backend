#!/usr/bin/env node
'use strict';

/**
 * Interactive Counseling Framework Certification (Stage 3 → 5)
 *
 * Ask → Student → Validate → Expertise → Permission → Colleges → Personalization
 * Never AI→AI→AI lecture chain.
 *
 *   node scripts/interactiveCounselingFrameworkCertification.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  parseEvaluationPriorities,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EvaluationParser');
const {
  buildFrameworkExpandMessage,
} = require('../constants/careerCounsellingV2Evaluation');
const {
  EXPLORE_PRESENT_LIMIT,
  CURATED_MODERN_CATALOG,
} = require('../constants/careerCounsellingV2ExploreModernColleges');

const OUT_DIR = path.join(__dirname, '..', 'smoke-results', 'counseling');

const report = {
  startedAt: new Date().toISOString(),
  cases: [],
  passed: 0,
  failed: 0,
};

function record(name, status, detail = {}) {
  report.cases.push({ name, status, ...detail });
  if (status === 'PASS') report.passed += 1;
  else report.failed += 1;
}

async function completeDiscovery() {
  let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
  r = await handleCareerCounsellingMessage('Class 12', r.context);
  r = await handleCareerCounsellingMessage('B.Tech', r.context);
  r = await handleCareerCounsellingMessage('Software engineer', r.context);
  r = await handleCareerCounsellingMessage('not yet', r.context);
  r = await handleCareerCounsellingMessage('English', r.context);
  return r;
}

async function run() {
  // Parser unit cases
  try {
    const one = parseEvaluationPriorities('placements');
    assert.ok(one.evaluationPriorities.includes('placements'));
    record('parser:one_priority', 'PASS');
  } catch (e) {
    record('parser:one_priority', 'FAIL', { error: String(e.message || e) });
  }

  try {
    const multi = parseEvaluationPriorities('placements and AI with internships');
    assert.ok(multi.evaluationPriorities.includes('placements'));
    assert.ok(multi.evaluationPriorities.length >= 2);
    record('parser:multiple_priorities', 'PASS');
  } catch (e) {
    record('parser:multiple_priorities', 'FAIL', { error: String(e.message || e) });
  }

  try {
    const dk = parseEvaluationPriorities("I don't know");
    assert.equal(dk.evaluationConfidence, 'suggested');
    assert.ok(dk.studentPriorities.length >= 2);
    record('parser:dont_know', 'PASS');
  } catch (e) {
    record('parser:dont_know', 'FAIL', { error: String(e.message || e) });
  }

  try {
    const sug = parseEvaluationPriorities('You suggest');
    assert.equal(sug.suggestedByCounselor, true);
    record('parser:you_suggest', 'PASS');
  } catch (e) {
    record('parser:you_suggest', 'FAIL', { error: String(e.message || e) });
  }

  try {
    const msg = buildFrameworkExpandMessage({
      studentPriorities: ['Placements', 'Coding Culture'],
    });
    assert.match(msg, /Your Priorities/i);
    assert.match(msg, /Additional Factors/i);
    assert.match(msg, /Would you like me to shortlist/i);
    assert.ok(msg.indexOf('Your Priorities') < msg.indexOf('Additional Factors'));
    record('static:framework_expand_structure', 'PASS');
  } catch (e) {
    record('static:framework_expand_structure', 'FAIL', { error: String(e.message || e) });
  }

  try {
    assert.equal(EXPLORE_PRESENT_LIMIT, 10);
    assert.ok(CURATED_MODERN_CATALOG.length >= 10);
    record('static:top10_catalog', 'PASS');
  } catch (e) {
    record('static:top10_catalog', 'FAIL', { error: String(e.message || e) });
  }

  // Live: one priority → framework → explore → personalization
  try {
    let r = await completeDiscovery();
    assert.equal(r.context.step, 'eval_ask_priorities');
    assert.match(r.reply, /what matters most|top things/i);
    // No AI→AI lecture: first eval turn is the ask
    assert.doesNotMatch(r.reply, /Friends are going|College A|future-ready learning usually means/i);

    r = await handleCareerCounsellingMessage('placements', r.context);
    assert.equal(r.context.step, 'eval_ask_permission');
    assert.match(r.reply, /Your Priorities/i);
    assert.match(r.reply, /✅\s*Placements/i);
    assert.match(r.reply, /Additional Factors/i);
    assert.match(r.reply, /Would you like me to shortlist/i);
    assert.deepEqual(r.context.profile.evaluationPriorities, ['placements']);

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, 'explore_modern_colleges');
    assert.ok((r.context.profile.exploreModernInstitutions || []).length >= 8);
    assert.match(r.reply, /narrow this down|personal goals/i);
    // Equal representation — NIAT present but not alone
    const names = (r.context.profile.exploreModernInstitutions || []).map((i) => i.name).join(' ');
    assert.match(names, /NIAT/i);
    assert.ok((r.context.profile.exploreModernInstitutions || []).length > 1);

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, 'personalized_discovery');
    record('live:one_priority_to_stage5', 'PASS');
  } catch (e) {
    record('live:one_priority_to_stage5', 'FAIL', { error: String(e.message || e) });
  }

  // Live: multiple priorities
  try {
    let r = await completeDiscovery();
    r = await handleCareerCounsellingMessage('hostel and placements', r.context);
    assert.ok(r.context.profile.evaluationPriorities.includes('placements'));
    assert.ok(r.context.profile.evaluationPriorities.includes('environment'));
    assert.match(r.reply, /Campus Life|Placements/i);
    record('live:multiple_priorities', 'PASS');
  } catch (e) {
    record('live:multiple_priorities', 'FAIL', { error: String(e.message || e) });
  }

  // Live: I don't know
  try {
    let r = await completeDiscovery();
    r = await handleCareerCounsellingMessage("I don't know", r.context);
    assert.equal(r.context.profile.evaluationConfidence, 'suggested');
    assert.match(r.reply, /Your Priorities/i);
    record('live:dont_know', 'PASS');
  } catch (e) {
    record('live:dont_know', 'FAIL', { error: String(e.message || e) });
  }

  // Live: you suggest
  try {
    let r = await completeDiscovery();
    r = await handleCareerCounsellingMessage('You suggest', r.context);
    assert.equal(r.context.profile.suggestedByCounselor, true);
    record('live:you_suggest', 'PASS');
  } catch (e) {
    record('live:you_suggest', 'FAIL', { error: String(e.message || e) });
  }

  // Decline recommendations
  try {
    let r = await completeDiscovery();
    r = await handleCareerCounsellingMessage('coding culture', r.context);
    r = await handleCareerCounsellingMessage('no', r.context);
    assert.equal(r.context.step, 'eval_permission_declined');
    assert.notEqual(r.context.stage, 'explore_modern_colleges');
    record('live:decline_recommendations', 'PASS');
  } catch (e) {
    record('live:decline_recommendations', 'FAIL', { error: String(e.message || e) });
  }

  // Accept then proceed Stage 5
  try {
    let r = await completeDiscovery();
    r = await handleCareerCounsellingMessage('affordable college with internships', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, 'explore_modern_colleges');
    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, 'personalized_discovery');
    // No modern lecture stage in between
    assert.notEqual(r.context.stage, 'modern_colleges');
    record('live:accept_to_stage5', 'PASS');
  } catch (e) {
    record('live:accept_to_stage5', 'FAIL', { error: String(e.message || e) });
  }

  // No AI→AI chain: after discovery only one bot ask before student priority
  try {
    let r = await completeDiscovery();
    const step1 = r.context.step;
    assert.equal(step1, 'eval_ask_priorities');
    // Student must reply before framework expand
    assert.doesNotMatch(r.reply, /Additional Factors I'll Evaluate/i);
    record('live:no_ai_ai_chain', 'PASS');
  } catch (e) {
    record('live:no_ai_ai_chain', 'FAIL', { error: String(e.message || e) });
  }

  report.finishedAt = new Date().toISOString();
  report.verdict = report.failed === 0 ? 'PASS' : 'FAIL';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `interactive-framework-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `interactive-framework-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'interactive-framework-latest.json'), JSON.stringify(report, null, 2));
  const md = [
    '# Interactive Counseling Framework Certification',
    '',
    `- Verdict: **${report.verdict}**`,
    `- Passed: ${report.passed}`,
    `- Failed: ${report.failed}`,
    '',
    ...report.cases.map(
      (c) => `- ${c.status} \`${c.name}\`${c.error ? ` — ${c.error}` : ''}`
    ),
  ].join('\n');
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(path.join(OUT_DIR, 'interactive-framework-latest.md'), md);

  console.log('────────────────────────────────────────');
  console.log(`Passed=${report.passed} Failed=${report.failed} Verdict=${report.verdict}`);
  console.log(`Report: ${mdPath}`);
  console.log('────────────────────────────────────────');
  process.exit(report.failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
