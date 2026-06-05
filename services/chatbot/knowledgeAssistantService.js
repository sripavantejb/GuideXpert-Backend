'use strict';

const { OpenAiCompatibleProvider } = require('../ai/providers/OpenAiCompatibleProvider');
const { buildSystemPrompt } = require('../ai/prompts/knowledgeAssistant.system');
const { searchKnowledge } = require('./knowledgeSearchService');
const { getConversationHistory } = require('./conversationHistoryService');
const { buildContext, formatUnifiedContext } = require('./contextBuilderService');
const { validateAiResponse } = require('./aiGuardrailService');

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

async function answer({
  inboundText,
  conversationId = null,
  leadContext = null,
  llmTimeoutMs = null,
} = {}) {
  console.log('[LLM-DEBUG] entered knowledgeAssistantService');

  if (!isKnowledgeAssistantEnabled()) {
    console.log('[LLM-DEBUG] answer return null: knowledge assistant disabled');
    return null;
  }

  const apiKey = String(process.env.LLM_API_KEY || '').trim();
  if (!apiKey) {
    console.log('[LLM-DEBUG] answer return null: LLM_API_KEY missing');
    return null;
  }

  const text = String(inboundText || '').trim();
  if (!text) {
    console.log('[LLM-DEBUG] answer return null: empty inbound text');
    return null;
  }

  try {
    const knowledgeResults = searchKnowledge(text, 5);
    const rawHistory = await loadConversationHistory(conversationId);
    const history = normalizeHistoryForProvider(
      removeCurrentInboundFromHistory(rawHistory, text)
    );
    const context = buildContext({ leadContext, knowledgeResults, history });
    const unifiedContext = formatUnifiedContext(context, {
      includeConversationContext: history.length === 0,
    });

    console.log('[KB] User Question:', text);
    console.log('[KB] Matches Found:', knowledgeResults.length);
    console.log('[KB] Selected IDs:', knowledgeResults.map((entry) => entry.id));
    console.log('[KB] Context Size:', context.knowledgeContext.length);
    console.log('[CTX] History Count:', history.length);
    console.log('[CTX] Knowledge Matches:', knowledgeResults.length);
    console.log('[CTX] CRM Included:', Boolean(context.crmContext));

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'system', content: unifiedContext },
      ...history,
      { role: 'user', content: text },
    ];
    console.log('[LLM-DEBUG] messageCount =', messages.length);

    const providerTimeoutMs = resolveLlmTimeoutMs(llmTimeoutMs || DEFAULT_TIMEOUT_MS);
    console.log('[LLM-DEBUG] provider timeout ms =', providerTimeoutMs);

    const result = await provider.chatCompletion({
      messages,
      timeoutMs: providerTimeoutMs,
      maxRetries: 0,
    });
    const guarded = validateAiResponse({
      response: result?.text,
      knowledgeResults,
    });
    console.log('[GUARDRAIL] Modified:', guarded.modified);
    if (guarded.reason) {
      console.log('[GUARDRAIL] Reason:', guarded.reason);
    }
    console.log('[LLM-DEBUG] received response', { model: result?.model });
    return { text: guarded.text, model: result?.model, guardrailModified: guarded.modified };
  } catch (e) {
    console.warn('[chatbot] knowledge assistant error', e.message);
    console.log('[LLM-DEBUG] caught error =', e.message);
  }

  console.log('[LLM-DEBUG] answer return null: fallthrough after try/catch');
  return null;
}

async function answerWithTimeout(params, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timedOut = false;
  const llmTimeoutMs = resolveLlmTimeoutMs(timeoutMs);

  const answerPromise = answer({ ...params, llmTimeoutMs }).catch((e) => {
    if (timedOut) {
      console.log('[LLM-DEBUG] ignored late knowledge assistant error after timeout', e.message);
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
