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

const SMALL_TALK_RE =
  /^(hi|hello|hey|hii|thanks|thank you|thankyou|goodbye|bye|menu|ok|okay)(?:\s+for\b.*)?[\s!.?]*$/i;

const CERT_NOISE_SUFFIX_RE = /\s*(?:\(v\d+\)|\[stress-\d+\])\s*$/i;

function stripCertNoise(text) {
  let value = String(text || '');
  while (CERT_NOISE_SUFFIX_RE.test(value)) {
    value = value.replace(CERT_NOISE_SUFFIX_RE, '');
  }
  return value.trim();
}

const ALLOW_LIST_EXTRA_RE =
  /\b(book(ing)?|session|support|contact|language|telugu|hindi|tamil|kannada|malayalam|marathi|bengali|document|documents|eligibility|cutoff|cutoffs|seat matrix|round analysis|nit|iiit|vit|bits|manipal|srm|keam|eamcet|neet|mains|advanced|percentile|percentiles|niat|nat|new[- ]?age)\b/i;

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
      // ignore
    }
  }
  return decodings;
}

function buildCandidates(originalText, englishMessage) {
  const sources = [originalText, englishMessage].filter(Boolean);
  const candidates = new Set();

  for (const source of sources) {
    const stripped = stripCertNoise(source);
    const normalized = normalizeForScope(stripped);
    if (normalized) candidates.add(normalized);
    for (const decoded of extractBase64Decodings(source)) {
      const decodedNorm = normalizeForScope(stripCertNoise(decoded));
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
    };
  }

  return null;
}

function isPolicyCategory(category) {
  return POLICY_CATEGORIES.includes(category);
}

function hasAllowSignal(text) {
  return ALLOW_SIGNAL_PATTERN.test(text) || ALLOW_LIST_EXTRA_RE.test(text);
}

function hasCareerContext(text) {
  return CAREER_CONTEXT_PATTERN.test(text);
}

function isCodeWritingRequest(text) {
  return CODE_WRITING_REQUEST_PATTERN.test(text);
}

function isSmallTalk(text) {
  return SMALL_TALK_RE.test(String(text || '').trim());
}

function hasConfidentAllowMatch(text) {
  if (!text) return false;
  if (isSmallTalk(text)) return true;
  if (hasAllowSignal(text)) return true;
  if (BRANCH_GUIDANCE_PATTERN.test(text)) return true;
  if (hasCareerContext(text) && !isCodeWritingRequest(text)) return true;
  return false;
}

/**
 * Allow-list-first segment: default reject unless confident in-domain match.
 */
function evaluateSegmentAllowList(rawSegment) {
  const text = normalizeForScope(rawSegment);
  if (!text) {
    return { allowed: true, text: rawSegment, category: 'small_talk', reason: 'empty_segment' };
  }

  const deny = findDenyMatchInText(text);

  if (deny?.category === 'prompt_injection') {
    return {
      allowed: false,
      text: rawSegment,
      category: deny.category,
      reason: deny.reason,
      policyBlock: true,
    };
  }

  if (deny && isPolicyCategory(deny.category)) {
    return {
      allowed: false,
      text: rawSegment,
      category: deny.category,
      reason: deny.reason,
      policyBlock: true,
    };
  }

  if (deny) {
    if (deny.category === 'programming') {
      if (hasCareerContext(text) && !isCodeWritingRequest(text)) {
        return {
          allowed: true,
          text: rawSegment,
          category: 'career_guidance',
          reason: 'career_context_allow',
        };
      }
      if (hasAllowSignal(text) && !isCodeWritingRequest(text)) {
        return {
          allowed: true,
          text: rawSegment,
          category: 'career_guidance',
          reason: 'counselling_context_allow',
        };
      }
    }
    return {
      allowed: false,
      text: rawSegment,
      category: deny.category,
      reason: deny.reason,
      policyBlock: false,
    };
  }

  if (hasConfidentAllowMatch(text)) {
    const category = hasCareerContext(text) ? 'career_guidance' : 'guidexpert_services';
    return {
      allowed: true,
      text: rawSegment,
      category,
      reason: 'allow_list_match',
      confidence: 1,
    };
  }

  return {
    allowed: false,
    text: rawSegment,
    category: 'general_trivia',
    reason: 'allow_list_miss',
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
      reason: primary?.reason || 'allow_list_match',
      confidence: primary?.confidence ?? 1,
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
      confidence: 1,
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
    confidence: 1,
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
  const segmentResults = segments.map((seg) => evaluateSegmentAllowList(seg));
  return mergeSegmentResults(segmentResults);
}

/**
 * Allow-list-first scope evaluation (fail-closed default).
 */
function evaluateAllowListScope({ originalText, englishMessage } = {}) {
  const strippedOriginal = stripCertNoise(originalText);
  const strippedEnglish = stripCertNoise(englishMessage);
  const candidates = buildCandidates(originalText, englishMessage);

  if (
    candidates.length === 0 ||
    (!strippedOriginal && !strippedEnglish)
  ) {
    return {
      allowed: true,
      category: 'small_talk',
      reason: 'empty_message',
      confidence: 1,
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

module.exports = {
  evaluateAllowListScope,
  evaluateSegmentAllowList,
  hasConfidentAllowMatch,
  buildCandidates,
  splitSegments,
  stripCertNoise,
};
