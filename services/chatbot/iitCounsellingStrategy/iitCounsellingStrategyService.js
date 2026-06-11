'use strict';

const { OpenAiCompatibleProvider } = require('../../ai/providers/OpenAiCompatibleProvider');
const { buildIitCounsellingStrategySystemPrompt } = require('../../ai/prompts/iitCounsellingStrategy.system');
const { buildRetrievalQuery } = require('../../../utils/knowledgeQueryBuilder');
const { aiDebugLog } = require('../aiDebugLog');
const {
  normalizeHistoryForProvider,
  removeCurrentInboundFromHistory,
  resolveLlmTimeoutMs,
  DEFAULT_TIMEOUT_MS,
} = require('../knowledgeAssistantService');
const { getConversationHistory } = require('../conversationHistoryService');
const { isIitCounsellingStrategyEnabled } = require('./iitCounsellingStrategyFlags');
const {
  searchIitCounsellingStrategyKnowledge,
  buildIitCounsellingStrategyContext,
  resolveDirectKbAnswer,
  resolveGroundedKbFallback,
} = require('./iitCounsellingStrategyKnowledgeService');
const {
  validateIitCounsellingStrategyResponse,
  UNKNOWN_FALLBACK,
} = require('./iitCounsellingStrategyGuardrailService');

const provider = new OpenAiCompatibleProvider();
const ICS_ANSWER_TIMEOUT_MS =
  Number(process.env.IIT_COUNSELLING_STRATEGY_TIMEOUT_MS) ||
  Number(process.env.KNOWLEDGE_ASSISTANT_TIMEOUT_MS) ||
  DEFAULT_TIMEOUT_MS;
const LLM_MAX_ATTEMPTS = 2;

async function loadConversationHistory(conversationId) {
  if (!conversationId) return [];
  try {
    return await getConversationHistory({ conversationId, limit: 8 });
  } catch (e) {
    console.warn('[chatbot] IIT counselling strategy history load failed', e.message);
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
      console.warn('[chatbot] iit_counselling_strategy empty_answer', { attempt });
    } catch (error) {
      const reason = /timeout/i.test(error.message) ? 'timeout' : 'provider_error';
      console.warn('[chatbot] iit_counselling_strategy llm_failure', {
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
  aiDebugLog('ICS', 'entered iitCounsellingStrategyService');

  if (!isIitCounsellingStrategyEnabled()) {
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
    const retrieval = await searchIitCounsellingStrategyKnowledge(text, {
      retrievalQuery,
      limit: 5,
    });
    const unifiedContext = buildIitCounsellingStrategyContext({
      knowledgeContext: retrieval.knowledgeContext,
      leadContext,
    });

    const messages = [
      { role: 'system', content: buildIitCounsellingStrategySystemPrompt() },
      { role: 'system', content: unifiedContext },
      ...history,
      { role: 'user', content: text },
    ];

    const llmBudgetMs = llmTimeoutMs || ICS_ANSWER_TIMEOUT_MS;
    const llmOutcome = await callLlmWithRetry({ messages, timeoutMs: llmBudgetMs });
    let responseText = llmOutcome?.result?.text || '';
    let answerSource = llmOutcome ? 'llm' : null;

    if (!String(responseText || '').trim()) {
      const groundedAnswer = resolveGroundedKbFallback(retrieval.kbResults, text);
      if (groundedAnswer) {
        responseText = groundedAnswer;
        answerSource = 'grounded_kb';
        console.warn('[chatbot] iit_counselling_strategy grounded_direct_answer', { query: text });
      }
    }

    const knowledgeResults = retrieval.kbResults;

    let guarded = validateIitCounsellingStrategyResponse({
      response: responseText,
      knowledgeResults,
      userMessage: languageMetadata?.originalMessage || text,
      englishUserMessage: languageMetadata?.translatedQuery || text,
    });

    if (
      guarded.modified &&
      (guarded.text === UNKNOWN_FALLBACK ||
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
        console.warn('[chatbot] iit_counselling_strategy grounded_kb_fallback', { query: text });
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
    console.warn('[chatbot] iit_counselling_strategy error', e.message);
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
      reject(new Error('iit_counselling_strategy_timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([answerPromise, timeoutPromise]);
  } catch (e) {
    const reason = /timeout/i.test(e.message) ? 'timeout' : 'provider_error';
    console.warn('[chatbot] iit_counselling_strategy_fallback', { reason, error: e.message });
    return null;
  }
}

async function answerWithTimeout(params, timeoutMs = ICS_ANSWER_TIMEOUT_MS) {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runAnswerWithTimeout(params, timeoutMs);
    if (result?.text) {
      return result;
    }
    if (attempt < maxAttempts) {
      console.warn('[chatbot] iit_counselling_strategy_retry', {
        attempt,
        reason: 'timeout_or_null',
      });
    }
  }

  return null;
}

module.exports = {
  answer,
  answerWithTimeout,
  callLlmWithRetry,
  ICS_ANSWER_TIMEOUT_MS,
};
