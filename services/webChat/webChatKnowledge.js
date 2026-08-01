'use strict';

const { searchKnowledge } = require('../chatbot/knowledgeSearchService');
const { chatCompletion } = require('../ai/llmClient');
const {
  getActiveWebChatSystemPrompt,
  DEFAULT_WEB_CHAT_SYSTEM_PROMPT,
} = require('../../utils/webChatPromptSettings');

const KB_DIRECT_SCORE = Number(process.env.WEB_CHAT_KB_DIRECT_SCORE) || 42;
const LLM_MAX_TOKENS = Number(process.env.WEB_CHAT_LLM_MAX_TOKENS) || 180;
const LLM_TIMEOUT_MS = Number(process.env.WEB_CHAT_LLM_TIMEOUT_MS) || 12000;

function isKnowledgeLike(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  return /\?|what|how|why|who|when|where|tell|explain|fee|cost|service|guidexpert|counsell|program|benefit/i.test(
    t
  );
}

function tryStaticFaq(message) {
  const t = String(message || '').trim().toLowerCase();
  if (/what is guideexpert|about guideexpert|who is guideexpert/.test(t)) {
    return {
      reply:
        'GuideXpert helps students with exam counselling, college shortlisting, rank prediction, branch guidance, and mentor support. You can use our free tools here or book a counselling session for personalized help.',
      usedLlm: false,
      source: 'static_faq',
    };
  }
  if (/what can you do|how can you help|what do you do/.test(t)) {
    return {
      reply:
        'I can run college predictor, rank predictor, and college comparison inside chat. I can also answer GuideXpert FAQs. Say "menu" to pick a tool.',
      usedLlm: false,
      source: 'static_faq',
    };
  }
  return null;
}

function tryKeywordAnswer(message) {
  const hits = searchKnowledge(message, 3);
  if (!hits.length || hits[0].score < KB_DIRECT_SCORE) {
    return null;
  }
  return {
    reply: hits[0].answer,
    usedLlm: false,
    source: 'knowledge_base',
    kbId: hits[0].id,
  };
}

async function tryLlmAnswer(message, kbHits = []) {
  const snippets = (kbHits.length ? kbHits : searchKnowledge(message, 2))
    .slice(0, 2)
    .map((h, i) => `[${i + 1}] Q: ${h.question}\nA: ${h.answer}`)
    .join('\n\n');

  let systemPrompt = DEFAULT_WEB_CHAT_SYSTEM_PROMPT;
  try {
    systemPrompt = await getActiveWebChatSystemPrompt();
  } catch (err) {
    console.warn('[WebChat] Failed to load configurable system prompt, using default:', err.message);
  }

  const completion = await chatCompletion({
    systemPrompt,
    userPrompt: `Knowledge:\n${snippets || 'No snippets.'}\n\nUser: ${message}`,
    temperature: 0.2,
    maxTokens: LLM_MAX_TOKENS,
    timeoutMs: LLM_TIMEOUT_MS,
  });

  return {
    reply: completion.content || 'I could not find a clear answer. Try "menu" to see what I can do.',
    usedLlm: true,
    source: 'llm_kb',
    model: completion.model || null,
  };
}

async function answerKnowledgeQuestion(message) {
  const staticFaq = tryStaticFaq(message);
  if (staticFaq) return staticFaq;

  const direct = tryKeywordAnswer(message);
  if (direct) return direct;

  if (!isKnowledgeLike(message)) {
    return null;
  }

  const hits = searchKnowledge(message, 3);
  if (!hits.length) {
    return null;
  }

  try {
    return await tryLlmAnswer(message, hits);
  } catch (error) {
    if (hits[0]?.answer) {
      return {
        reply: hits[0].answer,
        usedLlm: false,
        source: 'knowledge_base_fallback',
        kbId: hits[0].id,
      };
    }
    throw error;
  }
}

module.exports = {
  answerKnowledgeQuestion,
  isKnowledgeLike,
  tryKeywordAnswer,
};
