'use strict';

const UNKNOWN_FALLBACK =
  'I do not have verified information about that. Please contact the NIAT counselling team for accurate details.';
const OPPORTUNITY_FALLBACK =
  'Opportunities depend on skills, performance, and individual circumstances.';
const UNSUPPORTED_CLAIM_FALLBACK = 'I do not have verified information to support that claim.';

const GUARANTEE_PATTERNS = [
  /\bguarantee(?:d|s)?\b.{0,40}\b(?:job|jobs|placement|placements|internship|internships|salary|admission|admissions)\b/i,
  /\b(?:job|jobs|placement|placements|internship|internships|salary|admission|admissions)\b.{0,40}\bguarantee(?:d|s)?\b/i,
  /\b100%\s+(?:job|jobs|placement|placements|internship|internships|admission|admissions)\b/i,
];

const NUMERIC_CLAIM_PATTERN =
  /\b(?:\d{2,}(?:,\d{3})*(?:\.\d+)?%|\d{3,}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:lpa|lakhs?|crores?))\b/gi;

function buildKnowledgeText(knowledgeResults = []) {
  if (!Array.isArray(knowledgeResults)) return '';
  return knowledgeResults
    .map((entry) => [entry?.question, entry?.answer].filter(Boolean).join('\n'))
    .join('\n');
}

function extractNumericClaims(response) {
  return Array.from(String(response || '').matchAll(NUMERIC_CLAIM_PATTERN)).map((match) =>
    String(match[0]).trim()
  );
}

function containsGuaranteeClaim(response) {
  return GUARANTEE_PATTERNS.some((pattern) => pattern.test(String(response || '')));
}

function hasUnsupportedNumericClaim(response, knowledgeResults) {
  const claims = extractNumericClaims(response);
  if (claims.length === 0) return false;

  const knowledgeText = buildKnowledgeText(knowledgeResults);
  return claims.some((claim) => !knowledgeText.includes(claim));
}

function validateAiResponse({ response, knowledgeResults } = {}) {
  const text = String(response || '').trim();

  if (!text) {
    return { text: UNKNOWN_FALLBACK, modified: true, reason: 'empty_response' };
  }

  if (containsGuaranteeClaim(text)) {
    return { text: OPPORTUNITY_FALLBACK, modified: true, reason: 'guarantee_claim' };
  }

  if (hasUnsupportedNumericClaim(text, knowledgeResults)) {
    return { text: UNSUPPORTED_CLAIM_FALLBACK, modified: true, reason: 'unsupported_numeric_claim' };
  }

  return { text, modified: false, reason: null };
}

module.exports = {
  validateAiResponse,
  UNKNOWN_FALLBACK,
  OPPORTUNITY_FALLBACK,
  UNSUPPORTED_CLAIM_FALLBACK,
  extractNumericClaims,
};
