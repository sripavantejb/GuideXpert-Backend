/**
 * whatsaapBotTej — simple WhatsApp AI chatbot.
 *
 * Pipeline: inbound Gupshup webhook -> admin-panel system prompt (from the
 * /admin/system-prompt page, stored in MongoDB AppSettings) + recent history
 * + user message -> LLM (LLM_API_KEY / LLM_BASE_URL / LLM_MODEL in .env)
 * -> reply sent back over WhatsApp via Gupshup session message.
 */
'use strict';

const { parseInboundWebhook } = require('../utils/gupshupInboundPayload');
const { resolveSystemPromptForAdmin } = require('../utils/systemPromptSettings');
const { chatCompletion } = require('../services/ai/llmClient');
const { sendTextMessage } = require('../services/chatbot/gupshupSessionService');
const SimpleChatSession = require('./SimpleChatSession');

const MAX_HISTORY_MESSAGES = 20; // messages kept per phone (user + assistant)
const MAX_PROCESSED_IDS = 50; // provider message ids kept for dedup
const RESET_COMMANDS = new Set(['reset', '/reset', 'restart', 'clear']);

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant for GuideXpert answering questions over WhatsApp. ' +
  'Keep replies short, friendly and plain-text (no markdown).';

const NON_TEXT_REPLY =
  'Sorry, I can only understand text messages right now. Please type your question.';

const RESET_REPLY = 'Done! Our conversation has been reset. How can I help you?';

const ERROR_REPLY =
  'Sorry, I could not process that right now. Please try again in a moment.';

function llmMaxTokens() {
  const n = parseInt(process.env.SIMPLE_CHATBOT_MAX_TOKENS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

function llmTimeoutMs() {
  const n = parseInt(process.env.SIMPLE_CHATBOT_LLM_TIMEOUT_MS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

async function loadSystemPrompt() {
  try {
    const resolved = await resolveSystemPromptForAdmin();
    if (resolved && resolved.text && resolved.text.trim()) {
      return resolved.text;
    }
  } catch (err) {
    console.error('[whatsaapBotTej] failed to load admin system prompt:', err.message);
  }
  return DEFAULT_SYSTEM_PROMPT;
}

async function getOrCreateSession(phone10) {
  let session = await SimpleChatSession.findOne({ phone10 });
  if (!session) {
    session = new SimpleChatSession({ phone10, messages: [], processedMessageIds: [] });
  }
  return session;
}

/**
 * Handle one inbound Gupshup webhook body.
 * Never throws — always returns a small result object for logging.
 */
async function handleInboundWebhook(body) {
  const { isInbound, parsed } = parseInboundWebhook(body);
  if (!isInbound || !parsed || !parsed.phone10) {
    return { handled: false, reason: 'not_an_inbound_user_message' };
  }

  const phone10 = parsed.phone10;
  const session = await getOrCreateSession(phone10);

  // Dedup: Gupshup retries webhooks when it does not get a fast 200.
  if (parsed.providerMessageId && session.processedMessageIds.includes(parsed.providerMessageId)) {
    return { handled: false, reason: 'duplicate_message', phone10 };
  }
  if (parsed.providerMessageId) {
    session.processedMessageIds.push(parsed.providerMessageId);
    if (session.processedMessageIds.length > MAX_PROCESSED_IDS) {
      session.processedMessageIds = session.processedMessageIds.slice(-MAX_PROCESSED_IDS);
    }
  }

  // Only text (and interactive replies that carry text) are supported.
  const userText = String(parsed.text || '').trim();
  if (parsed.messageType !== 'text' || !userText) {
    await session.save();
    const send = await sendTextMessage(phone10, NON_TEXT_REPLY);
    return { handled: true, reason: 'non_text_message', phone10, sent: send.success };
  }

  // "reset" clears the conversation history.
  if (RESET_COMMANDS.has(userText.toLowerCase())) {
    session.messages = [];
    session.lastMessageAt = new Date();
    await session.save();
    const send = await sendTextMessage(phone10, RESET_REPLY);
    return { handled: true, reason: 'reset', phone10, sent: send.success };
  }

  const systemPrompt = await loadSystemPrompt();
  const history = session.messages.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let replyText;
  try {
    const result = await chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userText },
      ],
      temperature: 0.4,
      maxTokens: llmMaxTokens(),
      timeoutMs: llmTimeoutMs(),
    });
    replyText = (result.content || '').trim();
  } catch (err) {
    console.error('[whatsaapBotTej] LLM call failed:', err.message);
  }
  if (!replyText) replyText = ERROR_REPLY;

  session.messages.push({ role: 'user', content: userText, at: parsed.receivedAt || new Date() });
  session.messages.push({ role: 'assistant', content: replyText, at: new Date() });
  if (session.messages.length > MAX_HISTORY_MESSAGES) {
    session.messages = session.messages.slice(-MAX_HISTORY_MESSAGES);
  }
  session.lastMessageAt = new Date();
  await session.save();

  const send = await sendTextMessage(phone10, replyText);
  if (!send.success) {
    console.error('[whatsaapBotTej] WhatsApp send failed:', send.error);
  }

  return { handled: true, reason: 'replied', phone10, sent: send.success };
}

module.exports = { handleInboundWebhook };
