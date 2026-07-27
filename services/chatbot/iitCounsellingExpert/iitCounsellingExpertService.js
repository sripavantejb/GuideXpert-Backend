'use strict';

const { OpenAiCompatibleProvider } = require('../../ai/providers/OpenAiCompatibleProvider');
const { buildIitCounsellingExpertSystemPrompt } = require('../../ai/prompts/iitCounsellingExpert.system');
const { buildRetrievalQuery } = require('../../../utils/knowledgeQueryBuilder');
const { aiDebugLog } = require('../aiDebugLog');
const {
  normalizeHistoryForProvider,
  removeCurrentInboundFromHistory,
  resolveLlmTimeoutMs,
  DEFAULT_TIMEOUT_MS,
} = require('../knowledgeAssistantService');
const { getConversationHistory } = require('../conversationHistoryService');
const { isIitCounsellingExpertEnabled } = require('./iitCounsellingFlags');
const {
  searchIitCounsellingKnowledge,
  buildIitCounsellingContext,
  resolveGroundedKbFallback,
} = require('./iitCounsellingKnowledgeService');
const {
  validateIitCounsellingResponse,
  UNKNOWN_FALLBACK,
} = require('./iitCounsellingGuardrailService');

const provider = new OpenAiCompatibleProvider();
const ICE_ANSWER_TIMEOUT_MS =
  Number(process.env.IIT_COUNSELLING_EXPERT_TIMEOUT_MS) ||
  Number(process.env.KNOWLEDGE_ASSISTANT_TIMEOUT_MS) ||
  DEFAULT_TIMEOUT_MS;
const LLM_MAX_ATTEMPTS = 2;

const DIRECT_FACTUAL_ICE_PATTERN =
  /\bwhat is (jos+a+a?|csab|crl rank|obc-?ncl rank|home state quota|other state quota|float|slide|freeze)\b/i;

const ABOUT_FACTUAL_ICE_PATTERN =
  /\b(tell me about|know about|want to know about|about)\b.{0,60}\b(jos+a+a?|csab|float|slide|freeze|crl|obc-?ncl|home state|other state)\b/i;

function isDirectFactualIceQuery(text) {
  const value = String(text || '').trim();
  return DIRECT_FACTUAL_ICE_PATTERN.test(value) || ABOUT_FACTUAL_ICE_PATTERN.test(value);
}

function isUnsupportedIceFallbackText(text) {
  const value = String(text || '').trim();
  return (
    value === UNKNOWN_FALLBACK ||
    /don't currently have verified information (about|on) that topic/i.test(value)
  );
}

async function loadConversationHistory(conversationId) {
  if (!conversationId) return [];
  try {
    return await getConversationHistory({ conversationId, limit: 8 });
  } catch (e) {
    console.warn('[chatbot] IIT counselling expert history load failed', e.message);
    return [];
  }
}

async function callLlmWithRetry({ messages, timeoutMs }) {
  const providerTimeoutMs = resolveLlmTimeoutMs(timeoutMs);

  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await provider.chatCompletion({
        messages,
        timeoutMs: providerTimeoutMs,
        maxRetries: 0,
      });
      const text = String(result?.text || '').trim();
      if (text) {
        return { result, attempt };
      }
      console.warn('[chatbot] iit_counselling_expert empty_answer', { attempt });
    } catch (error) {
      const reason = /timeout/i.test(error.message) ? 'timeout' : 'provider_error';
      console.warn('[chatbot] iit_counselling_expert llm_failure', {
        attempt,
        reason,
        error: error.message,
      });
    }
  }

  return null;
}

async function answer({
  inboundText,
  conversationId = null,
  leadContext = null,
  llmTimeoutMs = null,
  languageMetadata = null,
} = {}) {
  aiDebugLog('ICE', 'entered iitCounsellingExpertService');

  if (!isIitCounsellingExpertEnabled()) {
    return null;
  }

  const apiKey = String(process.env.LLM_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }

  const text = String(inboundText || '').trim();
  if (!text) {
    return null;
  }

  try {
    const rawHistory = await loadConversationHistory(conversationId);
    const history = normalizeHistoryForProvider(
      removeCurrentInboundFromHistory(rawHistory, text)
    );
    const retrievalQuery = buildRetrievalQuery({ currentMessage: text, history });
    const retrieval = await searchIitCounsellingKnowledge(text, {
      retrievalQuery,
      limit: 5,
    });
    const knowledgeResults = retrieval.kbResults;
    const groundedPref = resolveGroundedKbFallback(knowledgeResults, text);
    if (isDirectFactualIceQuery(text) && groundedPref) {
      return {
        text: groundedPref,
        model: 'grounded_kb',
        guardrailModified: false,
        guardrailReason: null,
        languageLog: {
          englishResponse: groundedPref,
          resultIds: knowledgeResults.map((entry) => String(entry.id || '')),
          retrievalMode: retrieval.metrics?.mode || null,
          retrievalFallback: retrieval.metrics?.retrievalFallback || null,
          answerSource: 'grounded_kb',
          llmAttempts: 0,
        },
      };
    }

    if (!knowledgeResults.length && !groundedPref) {
      return {
        text: UNKNOWN_FALLBACK,
        model: null,
        guardrailModified: true,
        guardrailReason: 'no_grounding',
        languageLog: {
          englishResponse: UNKNOWN_FALLBACK,
          resultIds: [],
          retrievalMode: retrieval.metrics?.mode || null,
          retrievalFallback: retrieval.metrics?.retrievalFallback || null,
          answerSource: 'no_grounding',
          llmAttempts: 0,
        },
      };
    }

    const unifiedContext = buildIitCounsellingContext({
      knowledgeContext: retrieval.knowledgeContext,
      leadContext,
    });

    const messages = [
      { role: 'system', content: buildIitCounsellingExpertSystemPrompt() },
      { role: 'system', content: unifiedContext },
      ...history,
      { role: 'user', content: text },
    ];

    const llmBudgetMs = llmTimeoutMs || ICE_ANSWER_TIMEOUT_MS;
    const llmOutcome = await callLlmWithRetry({ messages, timeoutMs: llmBudgetMs });
    let responseText = llmOutcome?.result?.text || '';
    let answerSource = llmOutcome ? 'llm' : null;

    if (!String(responseText || '').trim()) {
      const groundedAnswer = resolveGroundedKbFallback(knowledgeResults, text);
      if (groundedAnswer) {
        responseText = groundedAnswer;
        answerSource = 'grounded_kb';
        console.warn('[chatbot] iit_counselling_expert grounded_direct_answer', { query: text });
      }
    }

    let guarded = validateIitCounsellingResponse({
      response: responseText,
      knowledgeResults,
      userMessage: languageMetadata?.originalMessage || text,
      englishUserMessage: languageMetadata?.translatedQuery || text,
      leadContext,
      resolvedLanguage: languageMetadata?.resolvedLanguage || 'en',
    });

    if (
      guarded.modified &&
      (isUnsupportedIceFallbackText(guarded.text) ||
        guarded.reason === 'no_grounding' ||
        guarded.reason === 'empty_response')
    ) {
      const groundedAnswer = resolveGroundedKbFallback(knowledgeResults, text);
      if (groundedAnswer) {
        guarded = {
          text: groundedAnswer,
          modified: true,
          reason: 'grounded_kb_fallback',
        };
        answerSource = answerSource || 'grounded_kb';
        console.warn('[chatbot] iit_counselling_expert grounded_kb_fallback', { query: text });
      }
    }

    return {
      text: guarded.text || UNKNOWN_FALLBACK,
      model: llmOutcome?.result?.model || (answerSource === 'grounded_kb' ? 'grounded_kb' : null),
      guardrailModified: guarded.modified,
      guardrailReason: guarded.reason,
      languageLog: {
        englishResponse: guarded.text,
        resultIds: knowledgeResults.map((entry) => String(entry.id || '')),
        retrievalMode: retrieval.metrics?.mode || null,
        retrievalFallback: retrieval.metrics?.retrievalFallback || null,
        answerSource,
        llmAttempts: llmOutcome?.attempt || LLM_MAX_ATTEMPTS,
      },
    };
  } catch (e) {
    console.warn('[chatbot] iit_counselling_expert error', e.message);
    const grounded = await resolveGroundedAnswerOnly(text);
    if (grounded) return grounded;
    return null;
  }
}

async function resolveGroundedAnswerOnly(inboundText) {
  const text = String(inboundText || '').trim();
  if (!text) return null;
  try {
    const retrieval = await searchIitCounsellingKnowledge(text, { limit: 5 });
    const groundedAnswer = resolveGroundedKbFallback(retrieval.kbResults, text);
    if (!groundedAnswer) return null;
    return {
      text: groundedAnswer,
      model: 'grounded_kb',
      guardrailModified: false,
      guardrailReason: 'grounded_kb_last_resort',
      languageLog: {
        englishResponse: groundedAnswer,
        resultIds: (retrieval.kbResults || []).map((entry) => String(entry.id || '')),
        retrievalMode: retrieval.metrics?.mode || null,
        retrievalFallback: retrieval.metrics?.retrievalFallback || null,
        answerSource: 'grounded_kb',
        llmAttempts: 0,
      },
    };
  } catch (error) {
    console.warn('[chatbot] iit_counselling_expert grounded_last_resort_failed', error.message);
    return null;
  }
}

async function runAnswerWithTimeout(params, timeoutMs) {
  let timedOut = false;
  const llmTimeoutMs = resolveLlmTimeoutMs(timeoutMs);

  const answerPromise = module.exports.answer({ ...params, llmTimeoutMs }).catch((e) => {
    if (timedOut) {
      return null;
    }
    throw e;
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error('iit_counselling_expert_timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([answerPromise, timeoutPromise]);
  } catch (e) {
    const reason = /timeout/i.test(e.message) ? 'timeout' : 'provider_error';
    console.warn('[chatbot] iit_counselling_expert_fallback', { reason, error: e.message });
    return resolveGroundedAnswerOnly(params?.inboundText);
  }
}

async function answerWithTimeout(params, timeoutMs = ICE_ANSWER_TIMEOUT_MS) {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runAnswerWithTimeout(params, timeoutMs);
    if (result?.text) {
      return result;
    }
    if (attempt < maxAttempts) {
      console.warn('[chatbot] iit_counselling_expert_retry', {
        attempt,
        reason: 'timeout_or_null',
      });
    }
  }

  return resolveGroundedAnswerOnly(params?.inboundText);
}

module.exports = {
  answer,
  answerWithTimeout,
  callLlmWithRetry,
  ICE_ANSWER_TIMEOUT_MS,
};
