'use strict';

const { OpenAiCompatibleProvider } = require('../../ai/providers/OpenAiCompatibleProvider');
const { buildLeadEventExtractionSystemPrompt } = require('../../ai/prompts/leadEventExtraction.system');
const { getConversationHistory } = require('../conversationHistoryService');
const { buildCrmContext } = require('../contextBuilderService');
const { logChatbotEvent } = require('../chatbotStructuredLog');
const WhatsAppLeadEvent = require('../../../models/WhatsAppLeadEvent');
const { isLeadEventExtractionEnabled } = require('./leadEventExtractionFlags');
const {
  resolveAssistantType,
  resolveLeadEventExtractionTimeoutMs,
} = require('./leadEventExtractionConstants');
const { validateExtractedEvents } = require('./leadEventSchemaValidator');
const { isLeadProfileEnabled } = require('../leadProfile/leadProfileFlags');
const { updateProfile } = require('../leadProfile/leadProfileService');

const provider = new OpenAiCompatibleProvider();
const RAW_JSON_MAX = 8000;

function truncateRawJson(value) {
  const text = String(value || '');
  return text.length > RAW_JSON_MAX ? text.slice(0, RAW_JSON_MAX) : text;
}

function buildExtractionPayload({
  userMessage,
  assistantReply,
  history,
  leadContext,
  intent,
  intentReason,
  assistantType,
}) {
  return {
    userMessage: String(userMessage || '').trim(),
    assistantReply: String(assistantReply || '').trim(),
    intent: intent || null,
    intentReason: intentReason || null,
    assistantType,
    leadContext: buildCrmContext(leadContext),
    history: Array.isArray(history)
      ? history.map((entry) => ({
          role: entry.role,
          content: String(entry.content || '').trim(),
        }))
      : [],
  };
}

async function extractAndPersist({
  conversation,
  inbound,
  outboundMessageId = null,
  intent = null,
  intentReason = null,
  userMessage = '',
  assistantReply = '',
  leadContext = null,
  contextPatch = {},
  assistantResult = null,
} = {}) {
  if (!isLeadEventExtractionEnabled()) {
    return null;
  }

  const inboundId = inbound?._id;
  const userText = String(userMessage || inbound?.text || '').trim();
  if (!inboundId || !userText) {
    return null;
  }

  try {
    const existing = await WhatsAppLeadEvent.findOne({ inboundMessageId: inboundId })
      .select('_id')
      .lean();
    if (existing) {
      return null;
    }

    const conversationId = conversation?._id;
    const phone = String(conversation?.phone || inbound?.phone || '').trim();
    if (!conversationId || !/^\d{10}$/.test(phone)) {
      return null;
    }

    const history = await getConversationHistory({ conversationId, limit: 8 });
    const assistantType = resolveAssistantType(intent, contextPatch);
    const payload = buildExtractionPayload({
      userMessage: userText,
      assistantReply,
      history,
      leadContext,
      intent,
      intentReason,
      assistantType,
    });

    const llmResult = await provider.chatCompletion({
      messages: [
        { role: 'system', content: buildLeadEventExtractionSystemPrompt() },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      temperature: 0,
      maxTokens: 800,
      timeoutMs: resolveLeadEventExtractionTimeoutMs(),
      maxRetries: 0,
    });

    const validated = validateExtractedEvents(llmResult?.text || '');
    const eventCount = validated.events.length;

    logChatbotEvent('lead_event_extracted', {
      conversationId,
      intent,
      assistantType,
      eventCount,
      extractionValid: validated.valid,
      extractionReason: validated.reason || null,
      extractionModel: llmResult?.model || null,
      guardrailModified: Boolean(assistantResult?.guardrailModified),
    });

    if (!eventCount) {
      return null;
    }

    const leadEvent = await WhatsAppLeadEvent.create({
      conversationId,
      phone,
      inboundMessageId: inboundId,
      outboundMessageId: outboundMessageId || null,
      intent: intent || null,
      intentReason: intentReason || null,
      productLine: conversation?.productLine || 'unknown',
      events: validated.events,
      assistantType,
      extractionModel: llmResult?.model || null,
      rawJson: truncateRawJson(validated.rawJson || llmResult?.text || ''),
      createdAt: new Date(),
    });

    if (isLeadProfileEnabled()) {
      updateProfile({
        phone,
        conversationId,
        events: validated.events,
        assistantType,
        inboundMessageId: inboundId,
      }).catch((err) => {
        console.warn('[chatbot] lead_profile_update_failed', err.message);
      });
    }

    return leadEvent;
  } catch (error) {
    console.warn('[chatbot] lead_event_extraction_failed', error.message);
    return null;
  }
}

module.exports = {
  extractAndPersist,
  buildExtractionPayload,
};
