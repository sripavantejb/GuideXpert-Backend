'use strict';

const { OpenAiCompatibleProvider } = require('../ai/providers/OpenAiCompatibleProvider');
const { buildSystemPrompt } = require('../ai/prompts/knowledgeAssistant.system');
const { searchKnowledgeAsync } = require('./knowledgeSearchService');
const { getConversationHistory } = require('./conversationHistoryService');
const { buildContext, formatUnifiedContext } = require('./contextBuilderService');
const { validateAiResponse } = require('./aiGuardrailService');
const { aiDebugLog } = require('./aiDebugLog');
const { buildRetrievalQuery } = require('../../utils/knowledgeQueryBuilder');
const { recordKnowledgeAssistantLanguageTurn } = require('./knowledgeAssistantLanguageLogService');

const provider = new OpenAiCompatibleProvider();
const DEFAULT_TIMEOUT_MS = Number(process.env.KNOWLEDGE_ASSISTANT_TIMEOUT_MS) || 8000;

function isKnowledgeAssistantEnabled() {
  return (
    String(process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED || '').trim() === '1' ||
    String(process.env.CHATBOT_LLM_ENABLED || '').trim() === '1'
  );
}

function removeCurrentInboundFromHistory(history, inboundText) {
  if (!Array.isArray(history) || history.length === 0) return [];

  const currentText = String(inboundText || '').trim();
  if (!currentText) return history;

  const next = history.slice();
  const last = next[next.length - 1];
  if (last?.role === 'user' && String(last.content || '').trim() === currentText) {
    next.pop();
  }
  return next;
}

function normalizeHistoryForProvider(history = []) {
  const normalized = [];

  for (const message of history) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(message?.content || '').trim();
    if (!content) continue;

    const last = normalized[normalized.length - 1];
    if (last && last.role === role) {
      if (last.content === content) continue;
      last.content = content;
      continue;
    }

    normalized.push({ role, content });
  }

  return normalized;
}

async function loadConversationHistory(conversationId) {
  if (!conversationId) return [];

  try {
    return await getConversationHistory({ conversationId, limit: 10 });
  } catch (e) {
    console.warn('[chatbot] conversation history load failed', e.message);
    return [];
  }
}

function resolveLlmTimeoutMs(requestedTimeoutMs) {
  const configured = Number(process.env.LLM_TIMEOUT_MS) || 20000;
  const budget = Number(requestedTimeoutMs) || DEFAULT_TIMEOUT_MS;
  return Math.max(3000, Math.min(configured, budget - 1500));
}

function logRetrievalMetrics(metrics = {}) {
  if (metrics.mode) {
    aiDebugLog('KB', 'Search Mode:', metrics.mode);
  }
  if (metrics.embedMs != null) {
    aiDebugLog('VECTOR', 'embedMs =', metrics.embedMs);
  }
  if (metrics.vectorSearchMs != null) {
    aiDebugLog('VECTOR', 'vectorSearchMs =', metrics.vectorSearchMs);
  }
  if (metrics.vectorCount != null) {
    aiDebugLog('VECTOR', 'count =', metrics.vectorCount);
  }
  if (metrics.keywordMs != null) {
    aiDebugLog('HYBRID', 'keywordMs =', metrics.keywordMs);
  }
  if (metrics.rerankMs != null) {
    aiDebugLog('HYBRID', 'rerankMs =', metrics.rerankMs);
  }
  if (metrics.totalMs != null) {
    aiDebugLog('HYBRID', 'totalMs =', metrics.totalMs);
  }
  if (metrics.resultIds) {
    aiDebugLog('HYBRID', 'ids =', metrics.resultIds);
  }
  if (metrics.fallback) {
    aiDebugLog('HYBRID', 'fallback =', metrics.fallback);
  }
}

async function answer({
  inboundText,
  conversationId = null,
  leadContext = null,
  llmTimeoutMs = null,
  languageMetadata = null,
} = {}) {
  aiDebugLog('LLM-DEBUG', 'entered knowledgeAssistantService');

  if (!isKnowledgeAssistantEnabled()) {
    aiDebugLog('LLM-DEBUG', 'answer return null: knowledge assistant disabled');
    return null;
  }

  const apiKey = String(process.env.LLM_API_KEY || '').trim();
  if (!apiKey) {
    aiDebugLog('LLM-DEBUG', 'answer return null: LLM_API_KEY missing');
    return null;
  }

  const text = String(inboundText || '').trim();
  if (!text) {
    aiDebugLog('LLM-DEBUG', 'answer return null: empty inbound text');
    return null;
  }

  try {
    const rawHistory = await loadConversationHistory(conversationId);
    const history = normalizeHistoryForProvider(
      removeCurrentInboundFromHistory(rawHistory, text)
    );
    const retrievalQuery = buildRetrievalQuery({ currentMessage: text, history });
    const { results: knowledgeResults, metrics } = await searchKnowledgeAsync(text, {
      retrievalQuery,
      limit: 5,
    });
    const context = buildContext({ leadContext, knowledgeResults, history });
    const unifiedContext = formatUnifiedContext(context, {
      includeConversationContext: history.length === 0,
    });

    aiDebugLog('KB', 'User Question:', text);
    aiDebugLog('KB', 'Retrieval Query:', retrievalQuery);
    aiDebugLog('KB', 'Matches Found:', knowledgeResults.length);
    aiDebugLog('KB', 'Selected IDs:', knowledgeResults.map((entry) => entry.id));
    aiDebugLog('KB', 'Context Size:', context.knowledgeContext.length);
    logRetrievalMetrics(metrics);
    aiDebugLog('CTX', 'History Count:', history.length);
    aiDebugLog('CTX', 'Knowledge Matches:', knowledgeResults.length);
    aiDebugLog('CTX', 'CRM Included:', Boolean(context.crmContext));

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'system', content: unifiedContext },
      ...history,
      { role: 'user', content: text },
    ];
    aiDebugLog('LLM-DEBUG', 'messageCount =', messages.length);

    const providerTimeoutMs = resolveLlmTimeoutMs(llmTimeoutMs || DEFAULT_TIMEOUT_MS);
    aiDebugLog('LLM-DEBUG', 'provider timeout ms =', providerTimeoutMs);

    const result = await provider.chatCompletion({
      messages,
      timeoutMs: providerTimeoutMs,
      maxRetries: 0,
    });
    const guarded = validateAiResponse({
      response: result?.text,
      knowledgeResults,
      userMessage: languageMetadata?.originalMessage || text,
      englishUserMessage: languageMetadata?.translatedQuery || text,
    });
    aiDebugLog('GUARDRAIL', 'Modified:', guarded.modified);
    if (guarded.reason) {
      aiDebugLog('GUARDRAIL', 'Reason:', guarded.reason);
    }
    aiDebugLog('LLM-DEBUG', 'received response', { model: result?.model });

    const languageLog = {
      conversationId,
      originalMessage: languageMetadata?.originalMessage || text,
      detectedLanguage: languageMetadata?.detectedLanguage || 'en',
      resolvedLanguage: languageMetadata?.resolvedLanguage || 'en',
      translatedQuery: languageMetadata?.translatedQuery || text,
      englishResponse: guarded.text,
      finalResponse: null,
      translationApplied: Boolean(languageMetadata?.translationApplied),
      guardrailModified: guarded.modified,
      retrievalMode: metrics?.mode || null,
      resultIds: knowledgeResults.map((entry) => String(entry.id)),
    };

    recordKnowledgeAssistantLanguageTurn(languageLog).catch(() => {});

    return {
      text: guarded.text,
      model: result?.model,
      guardrailModified: guarded.modified,
      guardrailReason: guarded.reason,
      languageLog,
    };
  } catch (e) {
    console.warn('[chatbot] knowledge assistant error', e.message);
    aiDebugLog('LLM-DEBUG', 'caught error =', e.message);
  }

  aiDebugLog('LLM-DEBUG', 'answer return null: fallthrough after try/catch');
  return null;
}

async function answerWithTimeout(params, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timedOut = false;
  const llmTimeoutMs = resolveLlmTimeoutMs(timeoutMs);

  const answerPromise = answer({ ...params, llmTimeoutMs }).catch((e) => {
    if (timedOut) {
      aiDebugLog('LLM-DEBUG', 'ignored late knowledge assistant error after timeout', e.message);
      return null;
    }
    throw e;
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error('knowledge_assistant_timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([answerPromise, timeoutPromise]);
  } catch (e) {
    console.warn('[chatbot] knowledge_assistant_fallback', e.message);
    return null;
  }
}

module.exports = {
  answer,
  answerWithTimeout,
  normalizeHistoryForProvider,
  removeCurrentInboundFromHistory,
  DEFAULT_TIMEOUT_MS,
  resolveLlmTimeoutMs,
};
