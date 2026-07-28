'use strict';

const DEFAULT_PRESERVE_TERMS = [
  'CSE',
  'ECE',
  'MECH',
  'EEE',
  'CIVIL',
  'NIAT',
  'NAT',
  'GuideXpert',
  'IIT',
  'AI',
  'ML',
  'EAMCET',
  'JEE',
  'KCET',
  'TS EAMCET',
  'AP EAMCET',
];

function parsePreserveTermsFromEnv() {
  const raw = String(process.env.TRANSLATION_PRESERVE_TERMS || '').trim();
  if (!raw) return DEFAULT_PRESERVE_TERMS.slice();
  return raw
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);
}

function getPreserveTerms() {
  return parsePreserveTermsFromEnv();
}

function buildPreserveTermsPrompt(terms = getPreserveTerms()) {
  return terms.join(', ');
}

module.exports = {
  DEFAULT_PRESERVE_TERMS,
  getPreserveTerms,
  buildPreserveTermsPrompt,
};
