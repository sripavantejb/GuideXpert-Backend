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
} = require('./iitCounsellingKnowledgeService');
const {
  validateIitCounsellingResponse,
  UNKNOWN_FALLBACK,
} = require('./iitCounsellingGuardrailService');

const provider = new OpenAiCompatibleProvider();

async function loadConversationHistory(conversationId) {
  if (!conversationId) return [];
  try {
    return await getConversationHistory({ conversationId, limit: 8 });
  } catch (e) {
    console.warn('[chatbot] IIT counselling expert history load failed', e.message);
    return [];
  }
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

    const providerTimeoutMs = resolveLlmTimeoutMs(llmTimeoutMs || DEFAULT_TIMEOUT_MS);
    const result = await provider.chatCompletion({
      messages,
      timeoutMs: providerTimeoutMs,
      maxRetries: 0,
    });

    const knowledgeResults = retrieval.kbResults;

    const guarded = validateIitCounsellingResponse({
      response: result?.text,
      knowledgeResults,
      userMessage: languageMetadata?.originalMessage || text,
      englishUserMessage: languageMetadata?.translatedQuery || text,
    });

    return {
      text: guarded.text || UNKNOWN_FALLBACK,
      model: result?.model,
      guardrailModified: guarded.modified,
      guardrailReason: guarded.reason,
      languageLog: {
        englishResponse: guarded.text,
        resultIds: knowledgeResults.map((entry) => String(entry.id || '')),
        retrievalMode: retrieval.metrics?.mode || null,
      },
    };
  } catch (e) {
    console.warn('[chatbot] iit_counselling_expert error', e.message);
    return null;
  }
}

async function answerWithTimeout(params, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timedOut = false;
  const llmTimeoutMs = resolveLlmTimeoutMs(timeoutMs);

  const answerPromise = answer({ ...params, llmTimeoutMs }).catch((e) => {
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
    console.warn('[chatbot] iit_counselling_expert_fallback', e.message);
    return null;
  }
}

module.exports = {
  answer,
  answerWithTimeout,
};
