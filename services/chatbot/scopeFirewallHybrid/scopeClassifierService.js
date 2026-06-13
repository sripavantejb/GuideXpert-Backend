'use strict';

const { evaluateScope, buildCandidates } = require('../scopeFirewall/scopeFirewallService');
const {
  ALLOW_SIGNAL_PATTERN,
  BRANCH_GUIDANCE_PATTERN,
  CODE_WRITING_REQUEST_PATTERN,
} = require('../scopeFirewall/scopeFirewallConstants');
const { normalizeForScope } = require('../scopeFirewall/scopeNormalizationService');
const { OpenAiCompatibleProvider } = require('../../ai/providers/OpenAiCompatibleProvider');
const { isScopeClassifierEnabled } = require('./scopeClassifierFlags');
const {
  CLASSIFIER_TRIGGER_REASONS,
  CONFIDENCE_THRESHOLD,
  CLASSIFIER_TIMEOUT_MS,
  CLASSIFIER_MAX_TOKENS,
  POLICY_BLOCK_CATEGORIES,
  AMBIGUOUS_ABBREV_RE,
  INDIC_SCRIPT_RE,
  SPACED_LETTERS_RE,
  HEX_SPACED_RE,
  URL_ENCODED_RE,
  BASE64_CANDIDATE_RE,
  INJECTION_HINT_RE,
  CAREER_DISPUTE_RE,
} = require('./scopeClassifierConstants');
const {
  buildScopeClassifierSystemPrompt,
  buildScopeClassifierUserPrompt,
} = require('./scopeClassifierPrompt');
const { normalizeClassifierResult } = require('./scopeClassifierSchemaValidator');

let providerInstance = null;

function getProvider() {
  if (!providerInstance) {
    providerInstance = new OpenAiCompatibleProvider();
  }
  return providerInstance;
}

function setScopeClassifierProviderForTests(provider) {
  providerInstance = provider;
}

function hasConfidentAllowSignal(originalText, englishMessage) {
  const candidates = buildCandidates(originalText, englishMessage);
  return candidates.some(
    (text) => ALLOW_SIGNAL_PATTERN.test(text) || BRANCH_GUIDANCE_PATTERN.test(text)
  );
}

function isCodeWritingRequest(originalText, englishMessage) {
  const candidates = buildCandidates(originalText, englishMessage);
  return candidates.some((text) => CODE_WRITING_REQUEST_PATTERN.test(text));
}

function detectUncertaintyReason(originalText, englishMessage) {
  const sources = [originalText, englishMessage].filter(Boolean).map(String);

  for (const raw of sources) {
    if (INDIC_SCRIPT_RE.test(raw)) return 'ambiguous';
    if (SPACED_LETTERS_RE.test(raw)) return 'low_confidence';
    if (HEX_SPACED_RE.test(raw)) return 'low_confidence';
    if (URL_ENCODED_RE.test(raw)) return 'low_confidence';
    if (BASE64_CANDIDATE_RE.test(raw)) return 'low_confidence';
    if (INJECTION_HINT_RE.test(normalizeForScope(raw))) return 'ambiguous';
    if (AMBIGUOUS_ABBREV_RE.test(normalizeForScope(raw))) return 'ambiguous';
  }

  return null;
}

function isDisputedRuleBlock(scope, originalText, englishMessage) {
  if (scope.allowed || scope.partialAllowed) return false;
  if (scope.category !== 'programming') return false;

  const norm = normalizeForScope(originalText);
  const engNorm = normalizeForScope(englishMessage || originalText);
  const combined = `${norm} ${engNorm}`;

  if (AMBIGUOUS_ABBREV_RE.test(norm) || AMBIGUOUS_ABBREV_RE.test(engNorm)) {
    return true;
  }

  if (CAREER_DISPUTE_RE.test(combined) && !isCodeWritingRequest(originalText, englishMessage)) {
    return true;
  }

  return false;
}

function isConfidentRuleDecision(scope, { originalText, englishMessage } = {}) {
  if (scope.partialAllowed) return true;
  if (scope.policyBlock && !scope.allowed) return true;

  if (!scope.allowed) {
    return !isDisputedRuleBlock(scope, originalText, englishMessage);
  }

  if (
    scope.reason === 'career_context_allow' ||
    scope.reason === 'counselling_context_allow'
  ) {
    return true;
  }

  if (hasConfidentAllowSignal(originalText, englishMessage)) {
    return true;
  }

  return false;
}

function resolveClassifierTriggerReason(scope, originalText, englishMessage) {
  const uncertainty = detectUncertaintyReason(originalText, englishMessage);
  if (uncertainty) return uncertainty;
  return scope.reason;
}

function shouldInvokeClassifier(scope, { originalText, englishMessage } = {}) {
  if (isConfidentRuleDecision(scope, { originalText, englishMessage })) {
    return false;
  }

  if (isDisputedRuleBlock(scope, originalText, englishMessage)) {
    return true;
  }

  if (!scope.allowed && !scope.partialAllowed) {
    return false;
  }

  const triggerReason = resolveClassifierTriggerReason(scope, originalText, englishMessage);
  return CLASSIFIER_TRIGGER_REASONS.includes(triggerReason);
}

function buildClassifierBlockScope(scope, classification, reason) {
  const category = classification?.category || scope.category || 'general_trivia';
  return {
    ...scope,
    allowed: false,
    partialAllowed: false,
    category,
    reason,
    blockedSegments: [
      {
        text: scope.llmInboundText || '',
        category,
        reason,
        policyBlock: POLICY_BLOCK_CATEGORIES.includes(category),
      },
    ],
    counsellingSegments: [],
    policyBlock: POLICY_BLOCK_CATEGORIES.includes(category),
    llmInboundText: null,
    classifierUsed: true,
    classifierBlock: true,
    classifierResult: classification || null,
  };
}

function applyClassifierResult(scope, classification) {
  if (!classification || !classification.meetsThreshold) {
    return buildClassifierBlockScope(scope, classification, 'classifier_low_confidence');
  }

  if (classification.allowed) {
    return {
      ...scope,
      allowed: true,
      partialAllowed: false,
      category: classification.category,
      reason: classification.reason || 'classifier_allow',
      blockedSegments: [],
      policyBlock: false,
      classifierUsed: true,
      classifierBlock: false,
      classifierResult: classification,
    };
  }

  return buildClassifierBlockScope(scope, classification, classification.reason || 'classifier_block');
}

async function classifyScope({ originalText, englishMessage, normalizedText }) {
  const provider = getProvider();
  const messages = [
    { role: 'system', content: buildScopeClassifierSystemPrompt() },
    {
      role: 'user',
      content: buildScopeClassifierUserPrompt({
        originalText,
        englishMessage,
        normalizedText: normalizedText || normalizeForScope(originalText),
      }),
    },
  ];

  const result = await provider.chatCompletion({
    messages,
    temperature: 0,
    maxTokens: CLASSIFIER_MAX_TOKENS,
    timeoutMs: CLASSIFIER_TIMEOUT_MS,
    maxRetries: 0,
  });

  const normalized = normalizeClassifierResult(result.text);
  if (!normalized) {
    return {
      allowed: false,
      category: 'prompt_injection',
      confidence: 0,
      reason: 'classifier_invalid_response',
      meetsThreshold: false,
    };
  }

  return normalized;
}

/**
 * Rule engine + optional LLM classifier for uncertain cases.
 * @param {{ originalText?: string, englishMessage?: string, intent?: string, botState?: object }} params
 */
async function evaluateScopeWithClassifier(params = {}) {
  const { originalText, englishMessage } = params;
  const scope = evaluateScope({ originalText, englishMessage });

  const base = {
    ...scope,
    classifierUsed: false,
    classifierBlock: false,
    classifierResult: null,
  };

  if (!isScopeClassifierEnabled()) {
    return base;
  }

  if (!shouldInvokeClassifier(scope, params)) {
    return base;
  }

  const normalizedText = normalizeForScope(originalText);
  try {
    const classification = await classifyScope({
      originalText,
      englishMessage: englishMessage || originalText,
      normalizedText,
    });
    return applyClassifierResult(scope, classification);
  } catch {
    return buildClassifierBlockScope(base, null, 'classifier_error');
  }
}

module.exports = {
  classifyScope,
  evaluateScopeWithClassifier,
  shouldInvokeClassifier,
  isConfidentRuleDecision,
  detectUncertaintyReason,
  isDisputedRuleBlock,
  applyClassifierResult,
  setScopeClassifierProviderForTests,
  CONFIDENCE_THRESHOLD,
};
