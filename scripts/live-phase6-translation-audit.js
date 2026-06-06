#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  LANGUAGE_CODES,
  TRANSLATION_PROBE_MESSAGES,
  SAMPLE_ENGLISH_FOR_OUTBOUND,
} = require('../constants/languageMatrixProbes');
const { detectLanguage } = require('../services/language/languageDetectionService');
const {
  translateToEnglish,
  translateFromEnglish,
} = require('../services/language/translationService');
const { assertReplyLanguage } = require('../utils/replyLanguageVerifier');

function isMostlyLatin(text) {
  const value = String(text || '');
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  const indic = value.replace(/[\x00-\x7F\s\d.,!?;:'"()\-]/g, '').length;
  return latin > 0 && indic === 0;
}

async function auditLanguage(lang) {
  const message = TRANSLATION_PROBE_MESSAGES[lang];
  const failures = [];

  const detection = await detectLanguage({ message });
  if (detection.language !== lang) {
    failures.push(`detectLanguage expected ${lang}, got ${detection.language}`);
  }
  if (Number(detection.confidence) < 0.75) {
    failures.push(`detectLanguage confidence too low: ${detection.confidence}`);
  }

  if (lang === 'en') {
    const english = await translateToEnglish(message, 'en');
    if (english !== message) {
      failures.push('translateToEnglish changed English input');
    }
    const outbound = await translateFromEnglish(SAMPLE_ENGLISH_FOR_OUTBOUND, 'en');
    if (outbound.text !== SAMPLE_ENGLISH_FOR_OUTBOUND) {
      failures.push('translateFromEnglish changed English output');
    }
  } else {
    const english = await translateToEnglish(message, lang);
    if (!english || english === message) {
      failures.push('translateToEnglish did not produce distinct English');
    }
    if (!isMostlyLatin(english)) {
      failures.push(`translateToEnglish not mostly Latin: ${english.slice(0, 80)}`);
    }

    const outbound = await translateFromEnglish(SAMPLE_ENGLISH_FOR_OUTBOUND, lang);
    const verification = assertReplyLanguage(outbound.text, lang);
    if (!verification.pass) {
      failures.push(
        `translateFromEnglish reply language mismatch: ${verification.reason} (${verification.detected})`
      );
    }
    if (outbound.passThrough) {
      failures.push('translateFromEnglish pass-through detected');
    }
  }

  return {
    lang,
    pass: failures.length === 0,
    failures,
    detection,
  };
}

async function main() {
  if (String(process.env.CHATBOT_MULTILINGUAL_ENABLED || '').trim() !== '1') {
    throw new Error('CHATBOT_MULTILINGUAL_ENABLED must be 1');
  }
  if (!String(process.env.LLM_API_KEY || '').trim()) {
    throw new Error('LLM_API_KEY required for translation audit');
  }

  const results = [];
  for (const lang of LANGUAGE_CODES) {
    console.log(`\n=== translation ${lang} ===`);
    const result = await auditLanguage(lang);
    results.push(result);
    console.log(result.pass ? 'PASS' : 'FAIL');
    for (const failure of result.failures) {
      console.log('  -', failure);
    }
  }

  const outDir = path.join(__dirname, '..', 'docs', 'phase-6-validation-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'translation-audit-results.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)
  );

  const allPass = results.every((row) => row.pass);
  console.log(`\nResults: ${outPath}`);
  console.log(allPass ? 'ALL TRANSLATION AUDITS PASSED' : 'SOME TRANSLATION AUDITS FAILED');
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
