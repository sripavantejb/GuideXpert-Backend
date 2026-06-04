'use strict';

const { OpenAiCompatibleProvider } = require('../ai/providers/OpenAiCompatibleProvider');
const { buildSystemPrompt } = require('../ai/prompts/knowledgeAssistant.system');
const { searchKnowledge } = require('./knowledgeSearchService');
const { getConversationHistory } = require('./conversationHistoryService');
const { buildContext, formatUnifiedContext } = require('./contextBuilderService');
const { validateAiResponse } = require('./aiGuardrailService');

const provider = new OpenAiCompatibleProvider();

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

async function answer({ inboundText, conversationId = null, leadContext = null } = {}) {
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
    const rawHistory = conversationId
      ? await getConversationHistory({ conversationId, limit: 10 })
      : [];
    const history = removeCurrentInboundFromHistory(rawHistory, text);
    const context = buildContext({ leadContext, knowledgeResults, history });
    const unifiedContext = formatUnifiedContext(context);

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
    ];
    messages.push({ role: 'user', content: text });

    const result = await provider.chatCompletion({ messages });
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

module.exports = { answer };
