'use strict';

const { OpenAiCompatibleProvider } = require('../../ai/providers/OpenAiCompatibleProvider');
const { buildCounsellorProgramSystemPrompt } = require('../../ai/prompts/counsellorProgramAssistant.system');
const { buildRetrievalQuery } = require('../../../utils/knowledgeQueryBuilder');
const { aiDebugLog } = require('../aiDebugLog');
const {
  normalizeHistoryForProvider,
  removeCurrentInboundFromHistory,
  resolveLlmTimeoutMs,
  DEFAULT_TIMEOUT_MS,
} = require('../knowledgeAssistantService');
const { getConversationHistory } = require('../conversationHistoryService');
const { isCounsellorProgramAssistantEnabled } = require('./counsellorProgramFlags');
const {
  searchCounsellorProgramKnowledge,
  buildCounsellorProgramContext,
} = require('./counsellorProgramKnowledgeService');
const {
  validateCounsellorProgramResponse,
  UNKNOWN_FALLBACK,
} = require('./counsellorProgramGuardrailService');
const { assertRagAllowed, refusalForRagBlock } = require('../scopeFirewall/ragScopeGuard');

const provider = new OpenAiCompatibleProvider();

async function loadConversationHistory(conversationId) {
  if (!conversationId) return [];
  try {
    return await getConversationHistory({ conversationId, limit: 8 });
  } catch (e) {
    console.warn('[chatbot] counsellor program history load failed', e.message);
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
  aiDebugLog('CPA', 'entered counsellorProgramAssistantService');

  if (!isCounsellorProgramAssistantEnabled()) {
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
    const retrieval = await searchCounsellorProgramKnowledge(text, {
      retrievalQuery,
      limit: 5,
    });
    const knowledgeResults = [...retrieval.kbResults, ...retrieval.faqHits.map((faq) => ({
      id: faq.slug,
      question: faq.title,
      answer: faq.answer,
      category: 'faq',
    }))];

    const ragCheck = assertRagAllowed({ knowledgeResults });
    if (!ragCheck.ok) {
      return {
        text: refusalForRagBlock(ragCheck.reason, languageMetadata?.resolvedLanguage || 'en'),
        model: null,
        guardrailModified: false,
        guardrailReason: ragCheck.reason,
        languageLog: null,
      };
    }

    const unifiedContext = buildCounsellorProgramContext({
      faqContext: retrieval.faqContext,
      knowledgeContext: retrieval.knowledgeContext,
      leadContext,
    });

    const messages = [
      { role: 'system', content: buildCounsellorProgramSystemPrompt() },
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

    const guarded = validateCounsellorProgramResponse({
      response: result?.text,
      knowledgeResults,
      faqHits: retrieval.faqHits,
      userMessage: languageMetadata?.originalMessage || text,
      englishUserMessage: languageMetadata?.translatedQuery || text,
      leadContext,
      resolvedLanguage: languageMetadata?.resolvedLanguage || 'en',
    });

    return {
      text: guarded.text || UNKNOWN_FALLBACK,
      model: result?.model,
      guardrailModified: guarded.modified,
      guardrailReason: guarded.reason,
      languageLog: {
        englishResponse: guarded.text,
        resultIds: knowledgeResults.map((entry) => String(entry.id || entry.slug || '')),
        retrievalMode: retrieval.metrics?.mode || null,
      },
    };
  } catch (e) {
    console.warn('[chatbot] counsellor_program_assistant error', e.message);
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
      reject(new Error('counsellor_program_assistant_timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([answerPromise, timeoutPromise]);
  } catch (e) {
    console.warn('[chatbot] counsellor_program_assistant_fallback', e.message);
    return null;
  }
}

module.exports = {
  answer,
  answerWithTimeout,
};
