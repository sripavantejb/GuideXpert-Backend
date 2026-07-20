#!/usr/bin/env node
'use strict';

/**
 * P0 Career Counselling routing certification — ≥500 natural utterances.
 *
 * Fail if ANY utterance routes to knowledge_assistant / unknown / guardrail-style
 * fallback instead of Career Counselling V2 entry intent.
 *
 *   node scripts/counselingRoutingCertification.js
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  classifyIntent,
  scoreCareerCounsellingGuidance,
} = require('../services/chatbot/intentClassifierService');
const {
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');

const OUT_DIR = path.join(__dirname, '../smoke-results/counseling');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_JSON = path.join(OUT_DIR, `routing-cert-${STAMP}.json`);
const REPORT_MD = path.join(OUT_DIR, `routing-cert-${STAMP}.md`);
const LATEST_JSON = path.join(OUT_DIR, 'routing-cert-latest.json');
const LATEST_MD = path.join(OUT_DIR, 'routing-cert-latest.md');

const GUARDRAIL_RE =
  /don't currently have verified information|do not currently have verified/i;

const FORBIDDEN_INTENTS = new Set([
  'unknown',
  'knowledge_assistant',
  'faq',
  'faq_query',
  'demo_support',
]);

const SEED = [
  "I'm confused.",
  'Help me choose.',
  "I don't know which college.",
  'Suggest something.',
  'Need guidance.',
  'I am worried.',
  'Can you help me?',
  'Which course is good?',
  "I'm lost.",
  "I don't know what to do after Intermediate.",
  'Which engineering branch should I take?',
  'I want a good future.',
  'I need career advice.',
  'I am confused to find a college',
  'confused to find a college',
  'recommend a college',
  'what should I choose',
  'I need help deciding',
  'what is best for me',
  'suggest a college',
  'I need counselling',
  'Admission guidance',
  'Career guidance',
  'Help me choose a college',
  'Which college should I join?',
  'Guide me',
  'Please help',
  'I am confused after Intermediate',
  "Don't know which course",
  'Find a college for me',
  'Looking for a college',
  'Need college suggestion',
  'Which college is best',
  'What is best for my future',
  'I am unsure about college',
  'Help me pick a branch',
  'Suggest a course',
  'Recommend something for CSE',
  'I need help choosing',
  'Can u help me',
];

const OPENERS = [
  'I am',
  "I'm",
  'Im',
  'Please',
  'Can you',
  'Could you',
  'I need',
  'I want',
  'Help me',
  '',
];

const FEELINGS = [
  'confused',
  'lost',
  'worried',
  'unsure',
  'stressed',
  'anxious',
  "don't know what to do",
  'not sure',
];

const GOALS = [
  'find a college',
  'choose a college',
  'pick a college',
  'select a college',
  'choose a course',
  'pick a branch',
  'choose CSE or ECE',
  'decide my career',
  'plan my future',
  'get admission guidance',
  'get career advice',
  'get counselling',
  'get counseling',
];

const QUESTIONS = [
  'which college should I join',
  'which college is good',
  'which course is good',
  'which branch should I take',
  'what should I choose',
  'what is best for me',
  'how do I choose a college',
  'suggest a college',
  'recommend a college',
  'suggest something',
  'recommend something',
  'need guidance',
  'need advice',
  'can you help me',
  'please help',
  'guide me',
  'I need help deciding',
  'I need help choosing',
  "I don't know which college",
  "I don't know which course",
  "I don't know what to do after Intermediate",
  "I don't know what to do after 12th",
  'I want a good future',
  'looking for a college',
  'find a college for me',
  'help me choose',
  'help me choose my future',
  'career guidance please',
  'admission guidance please',
  'counselling for college',
];

const CONTEXTS = [
  '',
  ' after Intermediate',
  ' after inter',
  ' after 12th',
  ' for engineering',
  ' for BTech',
  ' in Hyderabad',
  ' please',
  ' right now',
  ' urgently',
];

function buildUtterances() {
  const set = new Set();
  const add = (s) => {
    const t = String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length >= 2) set.add(t);
  };

  for (const s of SEED) add(s);

  for (const feel of FEELINGS) {
    for (const opener of OPENERS) {
      add(`${opener} ${feel}`.trim());
      for (const goal of GOALS) {
        add(`${opener} ${feel} to ${goal}`.trim());
        add(`${opener} ${feel} about ${goal}`.trim());
      }
    }
  }

  for (const q of QUESTIONS) {
    add(q);
    add(`${q}?`);
    for (const ctx of CONTEXTS) add(`${q}${ctx}`);
    for (const opener of ['Please', 'Can you', 'I need to know']) {
      add(`${opener} ${q}`);
    }
  }

  for (const goal of GOALS) {
    add(`Help me ${goal}`);
    add(`I need help to ${goal}`);
    add(`Please help me ${goal}`);
    add(`Can you help me ${goal}`);
  }

  // Natural paraphrases / typos / short forms
  const extras = [
    'cnfused about college',
    'plz help college choose',
    'college select cheyyali',
    'branch choose cheyali',
    'future enti cheppandi',
    'good college kavali',
    'best course enti',
    'suggest colleges',
    'any college suggestion',
    'need ur guidance',
    'need your guidance',
    'career doubt',
    'college doubt',
    'branch confusion',
    'course confusion',
    'what next after intermediate',
    'what next after 12th',
    'i have no idea about colleges',
    'no idea which course',
    'still confused',
    'totally lost',
    'very confused',
    'really worried about college',
    'parents asking which college',
    'help decide college',
    'decide between cse and ece',
    'is engineering good for me',
    'should i take engineering',
    'want counselling',
    'want counseling',
    'start counselling',
    'start counseling',
  ];
  for (const e of extras) add(e);

  // Pad combinatorially until ≥500
  const pads = ['', ' please', ' now', ' sir', ' madam', ' yaar', ' bro'];
  const base = [...set];
  let i = 0;
  while (set.size < 520 && i < base.length * pads.length) {
    const b = base[i % base.length];
    const p = pads[Math.floor(i / base.length) % pads.length];
    add(`${b}${p}`);
    i += 1;
  }

  return [...set];
}

function isForbiddenIntent(intent) {
  return FORBIDDEN_INTENTS.has(String(intent || ''));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const utterances = buildUtterances();
  const failures = [];
  const byIntent = {};
  let phase1Checked = 0;

  console.log(`Certifying ${utterances.length} counseling routing utterances…`);

  for (let i = 0; i < utterances.length; i += 1) {
    const text = utterances[i];
    const classified = classifyIntent(text, null, 'guidexpert', text);
    byIntent[classified.intent] = (byIntent[classified.intent] || 0) + 1;

    const scored = scoreCareerCounsellingGuidance(text, text);
    let failReason = null;

    if (classified.intent !== 'career_counselling_journey') {
      failReason = `intent=${classified.intent} reason=${classified.intentReason || ''}`;
    } else if (isForbiddenIntent(classified.intent)) {
      failReason = `forbidden_intent=${classified.intent}`;
    } else if (scored.score < 50) {
      failReason = `low_score=${scored.score}`;
    }

    // Spot-check first 25 + the critical production phrase for Phase 1 discovery start
    if (
      !failReason &&
      (phase1Checked < 25 || /confused to find a college/i.test(text))
    ) {
      const started = await handleCareerCounsellingMessage(text, {}, { isNewEntry: true });
      phase1Checked += 1;
      if (GUARDRAIL_RE.test(String(started.reply || ''))) {
        failReason = 'guardrail_fallback_reply';
      } else if (
        started.context?.stage !== 'discovery' &&
        started.context?.step !== 'awaiting_qualification'
      ) {
        // Allow already-in-journey edge cases only if orchestration present
        if (!started.orchestration) {
          failReason = `not_phase1 stage=${started.context?.stage} step=${started.context?.step}`;
        }
      }
    }

    if (failReason) {
      failures.push({
        text,
        intent: classified.intent,
        intentReason: classified.intentReason || null,
        score: scored.score,
        failReason,
      });
    }

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r  ${i + 1}/${utterances.length}  fails=${failures.length}   `);
    }
  }
  process.stdout.write('\n');

  const pass = failures.length === 0;
  const report = {
    name: 'Career Counselling Routing Certification',
    startedAt: new Date().toISOString(),
    utterances: utterances.length,
    passed: utterances.length - failures.length,
    failed: failures.length,
    verdict: pass ? 'PASS' : 'FAIL',
    byIntent,
    failures: failures.slice(0, 100),
    criticalSample: classifyIntent(
      'I am confused to find a college',
      null,
      'guidexpert',
      'I am confused to find a college'
    ),
  };

  const md = [
    '# Career Counselling Routing Certification',
    '',
    `- Utterances: **${report.utterances}**`,
    `- Passed: **${report.passed}**`,
    `- Failed: **${report.failed}**`,
    `- Verdict: **${report.verdict}**`,
    '',
    '## Intent distribution',
    '',
    ...Object.entries(byIntent).map(([k, n]) => `- ${k}: ${n}`),
    '',
    '## Critical sample',
    '',
    '```json',
    JSON.stringify(report.criticalSample, null, 2),
    '```',
    '',
    '## Failures (first 100)',
    '',
    failures.length
      ? failures
          .slice(0, 100)
          .map((f) => `- "${f.text}" → ${f.failReason}`)
          .join('\n')
      : '_None_',
    '',
  ].join('\n');

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(LATEST_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(REPORT_MD, md);
  fs.writeFileSync(LATEST_MD, md);

  console.log('────────────────────────────────────────');
  console.log(
    `Utterances: ${report.utterances}  PASS: ${report.passed}  FAIL: ${report.failed}`
  );
  console.log(`Critical: ${JSON.stringify(report.criticalSample)}`);
  console.log(`Verdict: ${report.verdict}`);
  console.log(`Report: ${REPORT_MD}`);
  console.log('────────────────────────────────────────');

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
