'use strict';

/**
 * LLM-only WhatsApp chatbot pipeline.
 *
 * Every reply comes from the OpenAI API using ONLY the system prompt saved in
 * the admin panel (AppSettings key `flowV3SystemPrompt`; the bundled
 * prompts/system_prompt.v1.md file is the offline fallback when Mongo has no
 * saved prompt). No flows, no knowledge bases, no routing, no translation.
 *
 * The only deterministic behavior kept is WhatsApp STOP/START compliance.
 */

const WhatsAppInboundMessage = require('../../models/WhatsAppInboundMessage');
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const { getSystemPromptSetting, readPromptFileSync } = require('../../utils/systemPromptSettings');
const { chatCompletion } = require('../ai/llmClient');
const whatsappOutbound = require('./whatsappOutboundService');
const { getBotState, transitionState } = require('./botStateService');
const { maskPhoneTail } = require('../../utils/chatbotPhone');

const STOP_RE = /^\s*(stop|unsubscribe|opt\s*out|optout)\s*$/i;
const START_RE = /^\s*(start|resume|subscribe)\s*$/i;

const OPT_OUT_REPLY =
  'You have been unsubscribed and will not receive further messages. Reply START anytime to resume.';
const ERROR_REPLY =
  'Sorry, I could not process that right now. Please try again in a moment.';

function historyLimit() {
  const n = parseInt(process.env.CHATBOT_HISTORY_MESSAGES || '16', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 40) : 16;
}

function llmMaxTokens() {
  const n = parseInt(process.env.CHATBOT_LLM_MAX_TOKENS || '600', 10);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

function llmTimeoutMs() {
  const n = parseInt(process.env.CHATBOT_LLM_TIMEOUT_MS || '30000', 10);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}

function llmTemperature() {
  const n = Number(process.env.CHATBOT_LLM_TEMPERATURE);
  return Number.isFinite(n) ? n : 0.4;
}

/**
 * Admin-panel prompt (Mongo) with bundled-file fallback.
 */
async function loadSystemPrompt() {
  const fromDb = await getSystemPromptSetting();
  if (fromDb && fromDb.text) return fromDb.text;
  const fromFile = readPromptFileSync();
  if (fromFile && fromFile.text) return fromFile.text;
  return null;
}

function extractInboundText(inbound) {
  const direct = String(inbound?.text || '').trim();
  if (direct) return direct;
  const interactive = inbound?.interactivePayload;
  if (interactive) {
    const title = interactive.title || interactive.reply?.title || interactive.postbackText;
    if (title) return String(title).trim();
  }
  return '';
}

/**
 * Chronological user/assistant history for the conversation, excluding the
 * current inbound message.
 */
async function loadConversationHistory(conversationId, excludeInboundId) {
  const limit = historyLimit();
  const [inbounds, outbounds] = await Promise.all([
    WhatsAppInboundMessage.find({
      conversationId,
      _id: { $ne: excludeInboundId },
      text: { $nin: [null, ''] },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('text createdAt')
      .lean(),
    WhatsAppOutboundMessage.find({
      conversationId,
      senderType: 'bot',
      textPreview: { $nin: [null, ''] },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('textPreview createdAt')
      .lean(),
  ]);

  const merged = [
    ...inbounds.map((m) => ({ role: 'user', content: m.text, at: m.createdAt })),
    ...outbounds.map((m) => ({ role: 'assistant', content: m.textPreview, at: m.createdAt })),
  ]
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .slice(-limit);

  return merged.map(({ role, content }) => ({ role, content: String(content) }));
}

async function sendReply({ conversation, inbound, text }) {
  return whatsappOutbound.sendBotTextReply({
    conversationId: conversation._id,
    phone10: conversation.phone,
    text,
    inReplyToInboundId: inbound._id,
  });
}

/**
 * Process one claimed inbound message. Same contract as the old orchestrator:
 * resolves to { outboundSuccess } (or { skipped }) for inbound bookkeeping.
 */
async function processInbound({ conversation, inbound }) {
  const userText = extractInboundText(inbound);
  const botState = await getBotState(conversation._id, conversation.phone);
  const optedOut = Boolean(botState?.context?.optedOut);

  if (STOP_RE.test(userText)) {
    await transitionState(conversation._id, conversation.phone, 'idle', { optedOut: true });
    const sent = await sendReply({ conversation, inbound, text: OPT_OUT_REPLY });
    return { outboundSuccess: Boolean(sent?.success), optOut: true };
  }

  if (optedOut) {
    if (!START_RE.test(userText)) {
      // Opted-out users get no bot messages until they reply START.
      return { outboundSuccess: true, suppressed: true };
    }
    await transitionState(conversation._id, conversation.phone, 'idle', { optedOut: false });
  }

  const systemPrompt = await loadSystemPrompt();
  if (!systemPrompt) {
    console.error('[llmOnlyChat] no system prompt configured (admin panel + file both empty)');
    const sent = await sendReply({ conversation, inbound, text: ERROR_REPLY });
    return { outboundSuccess: Boolean(sent?.success), error: 'system_prompt_missing' };
  }

  let replyText = null;
  try {
    const history = await loadConversationHistory(conversation._id, inbound._id);
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userText || '[non-text message]' },
      ],
      temperature: llmTemperature(),
      maxTokens: llmMaxTokens(),
      timeoutMs: llmTimeoutMs(),
    });
    replyText = result?.content || null;
  } catch (err) {
    console.error(
      '[llmOnlyChat] llm error',
      maskPhoneTail(conversation.phone),
      err?.message || err
    );
  }

  const sent = await sendReply({
    conversation,
    inbound,
    text: replyText || ERROR_REPLY,
  });
  return {
    outboundSuccess: Boolean(sent?.success),
    llmUsed: Boolean(replyText),
  };
}

module.exports = {
  processInbound,
  loadSystemPrompt,
  loadConversationHistory,
  extractInboundText,
  OPT_OUT_REPLY,
  ERROR_REPLY,
};
