'use strict';

const {
  DENY_PATTERNS,
  POLICY_CATEGORIES,
  ALLOW_SIGNAL_PATTERN,
  BRANCH_GUIDANCE_PATTERN,
  CAREER_CONTEXT_PATTERN,
  CODE_WRITING_REQUEST_PATTERN,
  SEGMENT_SPLIT_RE,
  BASE64_CANDIDATE_RE,
} = require('./scopeFirewallConstants');
const { normalizeForScope } = require('./scopeNormalizationService');
const { findFuzzyDenyMatch } = require('./scopeFuzzyMatcher');

function normalizeText(text) {
  return normalizeForScope(text);
}

function extractBase64Decodings(text) {
  const decodings = [];
  const raw = String(text || '');
  const matches = raw.match(BASE64_CANDIDATE_RE) || [];
  for (const candidate of matches) {
    try {
      const decoded = Buffer.from(candidate, 'base64').toString('utf8').trim();
      if (decoded.length >= 4 && decoded.length <= 500 && /[a-zA-Z]/.test(decoded)) {
        decodings.push(decoded);
      }
    } catch {
      // ignore invalid base64
    }
  }
  return decodings;
}

function buildCandidates(originalText, englishMessage) {
  const sources = [originalText, englishMessage].filter(Boolean);
  const candidates = new Set();

  for (const source of sources) {
    const normalized = normalizeForScope(source);
    if (normalized) candidates.add(normalized);
    for (const decoded of extractBase64Decodings(source)) {
      const decodedNorm = normalizeForScope(decoded);
      if (decodedNorm) candidates.add(decodedNorm);
    }
  }

  return [...candidates];
}

function findAllRegexDenyMatches(text) {
  const hits = [];
  for (const { category, pattern } of DENY_PATTERNS) {
    if (pattern.test(text)) {
      hits.push({ category, reason: 'deny_pattern' });
    }
  }
  return hits;
}

function findRegexDenyMatch(text) {
  const hits = findAllRegexDenyMatches(text);
  if (!hits.length) return null;

  const injection = hits.find((hit) => hit.category === 'prompt_injection');
  if (injection) return injection;

  const policy = hits.find((hit) => isPolicyCategory(hit.category));
  if (policy) return policy;

  return hits[0];
}

function findDenyMatchInText(text) {
  const regexHit = findRegexDenyMatch(text);
  if (regexHit) return { ...regexHit, matchType: 'regex' };

  const fuzzyHit = findFuzzyDenyMatch(text);
  if (fuzzyHit) {
    return {
      category: fuzzyHit.category,
      reason: 'fuzzy_match',
      matchType: 'fuzzy',
      matchedToken: fuzzyHit.token,
    };
  }

  return null;
}

function hasAllowSignal(text) {
  return ALLOW_SIGNAL_PATTERN.test(text) || BRANCH_GUIDANCE_PATTERN.test(text);
}

function hasCareerContext(text) {
  return CAREER_CONTEXT_PATTERN.test(text);
}

function isCodeWritingRequest(text) {
  return CODE_WRITING_REQUEST_PATTERN.test(text);
}

function isPolicyCategory(category) {
  return POLICY_CATEGORIES.includes(category);
}

/**
 * Single-segment decision. Counselling/career context can allow programming
 * mentions when the user is not requesting code.
 */
function evaluateSegment(rawSegment) {
  const text = normalizeForScope(rawSegment);
  if (!text) {
    return { allowed: true, text: rawSegment, category: null, reason: 'empty_segment' };
  }

  const deny = findDenyMatchInText(text);
  if (!deny) {
    return { allowed: true, text: rawSegment, category: null, reason: 'no_deny_match' };
  }

  if (deny.category === 'prompt_injection') {
    return {
      allowed: false,
      text: rawSegment,
      category: deny.category,
      reason: deny.reason,
      policyBlock: true,
    };
  }

  if (isPolicyCategory(deny.category)) {
    return {
      allowed: false,
      text: rawSegment,
      category: deny.category,
      reason: deny.reason,
      policyBlock: true,
    };
  }

  if (
    deny.category === 'programming' &&
    hasCareerContext(text) &&
    !isCodeWritingRequest(text)
  ) {
    return {
      allowed: true,
      text: rawSegment,
      category: 'career_guidance',
      reason: 'career_context_allow',
    };
  }

  if (
    deny.category === 'programming' &&
    hasAllowSignal(text) &&
    !isCodeWritingRequest(text)
  ) {
    return {
      allowed: true,
      text: rawSegment,
      category: 'branch_guidance',
      reason: 'counselling_context_allow',
    };
  }

  return {
    allowed: false,
    text: rawSegment,
    category: deny.category,
    reason: deny.reason,
    policyBlock: false,
  };
}

function splitSegments(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(SEGMENT_SPLIT_RE)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [raw];
}

function mergeSegmentResults(segmentResults) {
  const blockedSegments = segmentResults
    .filter((r) => !r.allowed)
    .map((r) => ({
      text: r.text,
      category: r.category,
      reason: r.reason,
      policyBlock: Boolean(r.policyBlock),
    }));

  const counsellingSegments = segmentResults.filter((r) => r.allowed).map((r) => r.text.trim());

  const policyBlock = blockedSegments.some((s) => s.policyBlock);

  if (blockedSegments.length === 0) {
    const primary = segmentResults.find((r) => r.category) || segmentResults[0];
    return {
      allowed: true,
      category: primary?.category || null,
      reason: primary?.reason || 'no_deny_match',
      counsellingSegments: counsellingSegments.length ? counsellingSegments : segmentResults.map((r) => r.text),
      blockedSegments: [],
      partialAllowed: false,
      policyBlock: false,
      llmInboundText: null,
    };
  }

  if (counsellingSegments.length > 0 && !policyBlock) {
    return {
      allowed: false,
      category: blockedSegments[0].category,
      reason: 'mixed_query',
      counsellingSegments,
      blockedSegments,
      partialAllowed: true,
      policyBlock: false,
      llmInboundText: counsellingSegments.join(' '),
    };
  }

  return {
    allowed: false,
    category: blockedSegments[0].category,
    reason: policyBlock ? 'policy_deny' : blockedSegments[0].reason,
    counsellingSegments: policyBlock ? [] : counsellingSegments,
    blockedSegments,
    partialAllowed: false,
    policyBlock,
    llmInboundText: null,
  };
}

function pickStricterScope(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.policyBlock || b.policyBlock) {
    return a.policyBlock ? a : b;
  }
  if (!a.allowed && !a.partialAllowed) return a;
  if (!b.allowed && !b.partialAllowed) return b;
  if (a.partialAllowed && !b.partialAllowed) return a;
  if (b.partialAllowed && !a.partialAllowed) return b;
  if (!a.allowed && b.allowed) return a;
  if (!b.allowed && a.allowed) return b;
  return a;
}

function evaluateCandidateText(candidateText) {
  const segments = splitSegments(candidateText);
  const segmentResults = segments.map((seg) => evaluateSegment(seg));
  return mergeSegmentResults(segmentResults);
}

/**
 * @param {{ originalText?: string, englishMessage?: string, intent?: string, botState?: object }} params
 */
function evaluateScope({ originalText, englishMessage } = {}) {
  const candidates = buildCandidates(originalText, englishMessage);

  if (candidates.length === 0) {
    return {
      allowed: true,
      category: null,
      reason: 'empty_message',
      counsellingSegments: [],
      blockedSegments: [],
      partialAllowed: false,
      policyBlock: false,
      llmInboundText: null,
    };
  }

  let result = null;
  for (const candidate of candidates) {
    result = pickStricterScope(result, evaluateCandidateText(candidate));
  }
  return result;
}

function isOutOfDomain(text) {
  const scope = evaluateScope({ originalText: text });
  if (scope.policyBlock) return true;
  if (scope.partialAllowed) return false;
  return scope.allowed === false;
}

function shouldBlockLlm(scope) {
  if (scope.allowed) return false;
  if (scope.partialAllowed) return false;
  return true;
}

function getLlmInboundText(scope, fallbackText) {
  if (scope.partialAllowed && scope.llmInboundText) {
    return scope.llmInboundText;
  }
  return fallbackText;
}

module.exports = {
  evaluateScope,
  isOutOfDomain,
  shouldBlockLlm,
  getLlmInboundText,
  normalizeText,
  splitSegments,
  buildCandidates,
};
