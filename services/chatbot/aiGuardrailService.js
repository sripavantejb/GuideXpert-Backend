'use strict';

const UNKNOWN_FALLBACK =
  "I don't currently have verified information about that topic. Please contact the GuideXpert counselling team for accurate guidance.";
const OPPORTUNITY_FALLBACK =
  'Opportunities depend on skills, performance, and individual circumstances.';
const UNSUPPORTED_CLAIM_FALLBACK =
  "I don't currently have verified information about that topic. Please contact the GuideXpert counselling team for accurate guidance.";

const { isGuideXpertIdentityQuestion } = require('./intentClassifierService');
const {
  coerceGuideXpertIdentityAnswer,
  isUnsupportedFallbackText,
} = require('../../utils/guideXpertIdentity');
const { resolveScopeFirewallReply } = require('../../constants/scopeFirewallReplies');
const { applyBookingHallucinationGuard } = require('./bookingContext/bookingHallucinationGuard');

const GUARANTEE_PATTERNS = [
  /\bguarantee(?:d|s)?\b.{0,40}\b(?:job|jobs|placement|placements|internship|internships|salary|admission|admissions)\b/i,
  /\b(?:job|jobs|placement|placements|internship|internships|salary|admission|admissions)\b.{0,40}\bguarantee(?:d|s)?\b/i,
  /\b100%\s+(?:job|jobs|placement|placements|internship|internships|admission|admissions)\b/i,
];

const NUMERIC_CLAIM_PATTERN =
  /\b(?:\d{2,}(?:,\d{3})*(?:\.\d+)?%|\d{3,}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:lpa|lakhs?|crores?))\b/gi;

const PLACEMENT_PERCENT_PATTERN =
  /\b\d+(?:\.\d+)?%\s*(?:placement|placements|placed|hired)\b/gi;

const PARTNERSHIP_CLAIM_PATTERNS = [
  /\b(?:partnered|partners|partnership)\s+with\s+([A-Za-z0-9][A-Za-z0-9&.'\s-]{1,60})/gi,
  /\b(?:tie[- ]?ups?|collaborat(?:es|ion|ing))\s+with\s+([A-Za-z0-9][A-Za-z0-9&.'\s-]{1,60})/gi,
  /\b(?:works|collaborates)\s+with\s+([A-Za-z0-9][A-Za-z0-9&.'\s-]{1,60})/gi,
  /\bassociated\s+with\s+([A-Za-z0-9][A-Za-z0-9&.'\s-]{1,60})/gi,
];

const COMPANY_TIEUP_CLAIM_PATTERNS = [
  /\b(?:internship(?:s)?\s+at|placed\s+at|placements?\s+at|hiring\s+from|recruits?\s+from|partners?\s+include)\s+([A-Za-z0-9][A-Za-z0-9&.'\s-]{1,60})/gi,
  /\b(?:internship(?:s)?|placements?)\s+(?:happen|happening)\s+at\s+([A-Za-z0-9][A-Za-z0-9&.'\s-]{1,60})/gi,
];

const MENTOR_CLAIM_PATTERNS = [
  /\b(?:mentored\s+by|guided\s+by|led\s+by|taught\s+by)\s+(?:mentor\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
  /\bIIT\s+mentor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
];

const GENERIC_ENTITY_ALLOWLIST = new Set([
  'universities',
  'university',
  'colleges',
  'college',
  'industry',
  'companies',
  'company',
  'students',
  'student',
  'niat',
  'iit',
  'engineering colleges',
  'partner engineering colleges',
  'different universities',
  'industry partners',
]);

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanExtractedClaim(value) {
  return String(value || '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractClaimsWithPatterns(response, patterns) {
  const text = String(response || '');
  const claims = [];

  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const regex = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(regex)) {
      const claim = cleanExtractedClaim(match[1]);
      if (claim) claims.push(claim);
    }
  }

  return claims;
}

function buildKnowledgeText(knowledgeResults = []) {
  if (!Array.isArray(knowledgeResults)) return '';
  return knowledgeResults
    .map((entry) => [entry?.question, entry?.answer].filter(Boolean).join('\n'))
    .join('\n');
}

function extractNumericClaims(response) {
  const text = String(response || '');
  const claims = new Set();

  for (const match of text.matchAll(NUMERIC_CLAIM_PATTERN)) {
    claims.add(String(match[0]).trim());
  }
  for (const match of text.matchAll(PLACEMENT_PERCENT_PATTERN)) {
    const value = String(match[0]).trim();
    claims.add(value);
    const percent = value.match(/\d+(?:\.\d+)?%/);
    if (percent) claims.add(percent[0]);
  }

  return [...claims];
}

function extractPartnershipClaims(response) {
  return extractClaimsWithPatterns(response, PARTNERSHIP_CLAIM_PATTERNS);
}

function extractCompanyTieupClaims(response) {
  return extractClaimsWithPatterns(response, COMPANY_TIEUP_CLAIM_PATTERNS);
}

function extractMentorNameClaims(response) {
  return extractClaimsWithPatterns(response, MENTOR_CLAIM_PATTERNS);
}

function isGenericEntity(claim) {
  const normalized = normalizeForMatch(claim);
  if (!normalized) return true;
  if (GENERIC_ENTITY_ALLOWLIST.has(normalized)) return true;
  return [...GENERIC_ENTITY_ALLOWLIST].some(
    (term) => normalized === term || normalized.startsWith(`${term} `) || normalized.endsWith(` ${term}`)
  );
}

function isClaimSupportedInKnowledge(claim, knowledgeText) {
  const claimNorm = normalizeForMatch(claim);
  const kbNorm = normalizeForMatch(knowledgeText);
  if (!claimNorm) return true;
  return kbNorm.includes(claimNorm);
}

function normalizeNumericToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/,/g, '');
}

function extractUserProvidedNumbers(...messages) {
  const allowed = new Set();

  for (const message of messages) {
    const text = String(message || '');
    if (!text) continue;

    for (const claim of extractNumericClaims(text)) {
      allowed.add(normalizeNumericToken(claim));
    }

    for (const match of text.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
      allowed.add(normalizeNumericToken(match[0]));
    }
  }

  return allowed;
}

function isAllowedUserNumber(claim, allowedNumbers) {
  if (!allowedNumbers || allowedNumbers.size === 0) return false;
  return allowedNumbers.has(normalizeNumericToken(claim));
}

function containsGuaranteeClaim(response) {
  return GUARANTEE_PATTERNS.some((pattern) => pattern.test(String(response || '')));
}

function hasUnsupportedNumericClaim(response, knowledgeResults, allowedNumbers = new Set()) {
  const claims = extractNumericClaims(response);
  if (claims.length === 0) return false;

  const knowledgeText = buildKnowledgeText(knowledgeResults);
  return claims.some((claim) => {
    if (isAllowedUserNumber(claim, allowedNumbers)) return false;
    return !knowledgeText.toLowerCase().includes(claim.toLowerCase());
  });
}

function findUnsupportedEntityClaim(response, knowledgeResults, extractClaims, reason) {
  const knowledgeText = buildKnowledgeText(knowledgeResults);
  const claims = extractClaims(response);

  for (const claim of claims) {
    if (isGenericEntity(claim)) continue;
    if (!isClaimSupportedInKnowledge(claim, knowledgeText)) {
      return { unsupported: true, reason, claim };
    }
  }

  return null;
}

function hasUnsupportedEntityClaim(response, knowledgeResults) {
  const checks = [
    [extractPartnershipClaims, 'unsupported_partnership_claim'],
    [extractCompanyTieupClaims, 'unsupported_company_tieup_claim'],
    [extractMentorNameClaims, 'unsupported_mentor_claim'],
  ];

  for (const [extractClaims, reason] of checks) {
    const result = findUnsupportedEntityClaim(response, knowledgeResults, extractClaims, reason);
    if (result) return result;
  }

  return { unsupported: false, reason: null, claim: null };
}

function applyGuideXpertIdentitySafetyNet({
  response,
  knowledgeResults,
  userMessage,
  englishUserMessage,
  reason,
} = {}) {
  const identityQuestion = isGuideXpertIdentityQuestion(userMessage, englishUserMessage);
  const grounded = coerceGuideXpertIdentityAnswer({
    response,
    knowledgeResults,
    isIdentityQuestion: identityQuestion,
  });
  if (grounded) {
    return { text: grounded, modified: true, reason: reason || 'guidexpert_identity_grounded' };
  }
  return null;
}

function validateAiResponse({
  response,
  knowledgeResults,
  userMessage = null,
  englishUserMessage = null,
  leadContext = null,
  resolvedLanguage = 'en',
} = {}) {
  const text = String(response || '').trim();
  const allowedNumbers = extractUserProvidedNumbers(userMessage, englishUserMessage);
  const identityQuestion = isGuideXpertIdentityQuestion(userMessage, englishUserMessage);
  const hits = Array.isArray(knowledgeResults) ? knowledgeResults : [];

  if (!hits.length && !identityQuestion) {
    return {
      text: resolveScopeFirewallReply('en'),
      modified: true,
      reason: 'no_grounding',
    };
  }

  if (!text) {
    const identitySafe = applyGuideXpertIdentitySafetyNet({
      response: text,
      knowledgeResults,
      userMessage,
      englishUserMessage,
      reason: 'guidexpert_identity_grounded',
    });
    if (identitySafe) return identitySafe;
    return { text: UNKNOWN_FALLBACK, modified: true, reason: 'empty_response' };
  }

  if (identityQuestion && isUnsupportedFallbackText(text)) {
    const identitySafe = applyGuideXpertIdentitySafetyNet({
      response: text,
      knowledgeResults,
      userMessage,
      englishUserMessage,
      reason: 'guidexpert_identity_grounded',
    });
    if (identitySafe) return identitySafe;
  }

  if (containsGuaranteeClaim(text)) {
    return { text: OPPORTUNITY_FALLBACK, modified: true, reason: 'guarantee_claim' };
  }

  if (hasUnsupportedNumericClaim(text, knowledgeResults, allowedNumbers)) {
    if (identityQuestion) {
      const identitySafe = applyGuideXpertIdentitySafetyNet({
        response: text,
        knowledgeResults,
        userMessage,
        englishUserMessage,
        reason: 'guidexpert_identity_grounded',
      });
      if (identitySafe) return identitySafe;
    }
    return { text: UNSUPPORTED_CLAIM_FALLBACK, modified: true, reason: 'unsupported_numeric_claim' };
  }

  const entityClaim = hasUnsupportedEntityClaim(text, knowledgeResults);
  if (entityClaim.unsupported) {
    if (identityQuestion) {
      const identitySafe = applyGuideXpertIdentitySafetyNet({
        response: text,
        knowledgeResults,
        userMessage,
        englishUserMessage,
        reason: 'guidexpert_identity_grounded',
      });
      if (identitySafe) return identitySafe;
    }
    return {
      text: UNSUPPORTED_CLAIM_FALLBACK,
      modified: true,
      reason: entityClaim.reason,
    };
  }

  const bookingGuard = applyBookingHallucinationGuard({
    response: text,
    leadContext,
    resolvedLanguage,
  });
  if (bookingGuard.modified) {
    return bookingGuard;
  }

  return { text, modified: false, reason: null };
}

module.exports = {
  validateAiResponse,
  UNKNOWN_FALLBACK,
  OPPORTUNITY_FALLBACK,
  UNSUPPORTED_CLAIM_FALLBACK,
  extractNumericClaims,
  extractUserProvidedNumbers,
  extractPartnershipClaims,
  extractCompanyTieupClaims,
  extractMentorNameClaims,
  isClaimSupportedInKnowledge,
  hasUnsupportedEntityClaim,
  isGenericEntity,
};
