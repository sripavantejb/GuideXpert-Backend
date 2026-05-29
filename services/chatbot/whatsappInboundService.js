const WhatsAppInboundMessage = require('../../models/WhatsAppInboundMessage');
const WhatsAppWebhookEvent = require('../../models/WhatsAppWebhookEvent');
const {
  parseInboundWebhook,
  buildInboundDedupeKey,
  sanitizeInboundSnippet,
} = require('../../utils/gupshupInboundPayload');
const { maskPhoneTail } = require('../../utils/chatbotPhone');
const { verifyGupshupWebhookRequest } = require('../../utils/gupshupWebhookAuth');
const { getOrCreateConversation, touchInbound } = require('./conversationService');
const { processInbound } = require('./chatbotOrchestratorService');

const rateLimitMap = new Map();

function rateLimitPerPhone(phone10) {
  const max = parseInt(process.env.CHATBOT_RATE_LIMIT_PER_MIN || '12', 10) || 12;
  const now = Date.now();
  const key = phone10;
  let entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > 60000) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > max) return false;
  return true;
}

/**
 * Build inbound document fields (conversationId required at insert).
 */
function buildInboundMessageFields({
  conversationId,
  parsed,
  body,
  receivedAt,
  dedupeKey,
  webhookEventId,
}) {
  return {
    conversationId,
    phone: parsed.phone10,
    providerMessageId: parsed.providerMessageId || null,
    messageType: parsed.messageType || 'text',
    text: parsed.text,
    interactivePayload: parsed.interactivePayload,
    mediaUrl: parsed.mediaUrl,
    location: parsed.location,
    rawPayloadSnippet: sanitizeInboundSnippet(body, 1500),
    receivedAt: parsed.receivedAt || receivedAt,
    processStatus: 'pending',
    dedupeKey,
    whatsappWebhookEventId: webhookEventId,
  };
}

/**
 * Handle inbound user message webhook.
 * @returns {Promise<{ handled: boolean, dedupe?: boolean, error?: string, statusCode?: number }>}
 */
async function handleInboundWebhook(req, body, receivedAt = new Date()) {
  const auth = verifyGupshupWebhookRequest(req);
  if (!auth.ok) {
    console.warn('[chatbot] webhook auth failed', auth.error);
    return { handled: false, error: auth.error, statusCode: auth.statusCode };
  }

  const { isInbound, parsed } = parseInboundWebhook(body);
  if (!isInbound || !parsed || !parsed.phone10) {
    return { handled: false };
  }

  if (!rateLimitPerPhone(parsed.phone10)) {
    console.warn('[chatbot] rate_limited', maskPhoneTail(parsed.phone10));
    return { handled: true, rateLimited: true };
  }

  const dedupeKey = buildInboundDedupeKey(parsed, body);

  const { conversation, leadLinks } = await getOrCreateConversation(parsed.phone10);

  let webhookEvent = null;
  try {
    webhookEvent = await WhatsAppWebhookEvent.create({
      eventKind: 'inbound',
      webhookDedupeKey: `in:${dedupeKey}`,
      receivedAt,
      phone: parsed.phone10,
      status: 'inbound',
      rawPayloadSnippet: sanitizeInboundSnippet(body),
      matchedBy: 'inbound',
      matchConfidence: 'high',
    });
  } catch (e) {
    if (e && (e.code === 11000 || String(e.message).includes('E11000'))) {
      return { handled: true, dedupe: true };
    }
    throw e;
  }

  let inboundDoc;
  try {
    inboundDoc = await WhatsAppInboundMessage.create(
      buildInboundMessageFields({
        conversationId: conversation._id,
        parsed,
        body,
        receivedAt,
        dedupeKey,
        webhookEventId: webhookEvent._id,
      })
    );
    await WhatsAppWebhookEvent.updateOne(
      { _id: webhookEvent._id },
      { $set: { inboundMessageId: inboundDoc._id } }
    );
  } catch (e) {
    if (e && (e.code === 11000 || String(e.message).includes('E11000'))) {
      return { handled: true, dedupe: true };
    }
    throw e;
  }

  await touchInbound(conversation._id, receivedAt);

  try {
    await processInbound({
      conversation,
      inbound: inboundDoc,
      leadLinks,
    });
    await WhatsAppInboundMessage.updateOne(
      { _id: inboundDoc._id },
      {
        $set: {
          processStatus: 'processed',
          processedAt: new Date(),
        },
      }
    );
  } catch (err) {
    console.error('[chatbot] process error', maskPhoneTail(parsed.phone10), err.message);
    await WhatsAppInboundMessage.updateOne(
      { _id: inboundDoc._id },
      {
        $set: {
          processStatus: 'failed',
          processError: String(err.message).slice(0, 2000),
          processedAt: new Date(),
        },
      }
    );
  }

  return { handled: true, inboundId: String(inboundDoc._id) };
}

/**
 * Replay pending inbound messages (cron).
 */
async function replayPendingInbound(limit = 30) {
  const pending = await WhatsAppInboundMessage.find({ processStatus: 'pending' })
    .sort({ receivedAt: 1 })
    .limit(limit)
    .lean();

  let processed = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      if (!row.conversationId) {
        continue;
      }
      const conversation = await require('../../models/WhatsAppConversation').findById(
        row.conversationId
      );
      if (!conversation) continue;
      const { resolveLeadLinks } = require('../../utils/chatbotPhone');
      const leadLinks = await resolveLeadLinks(row.phone);
      await processInbound({
        conversation,
        inbound: row,
        leadLinks,
      });
      await WhatsAppInboundMessage.updateOne(
        { _id: row._id },
        { $set: { processStatus: 'processed', processedAt: new Date() } }
      );
      processed += 1;
    } catch (e) {
      await WhatsAppInboundMessage.updateOne(
        { _id: row._id },
        {
          $set: {
            processStatus: 'failed',
            processError: String(e.message).slice(0, 500),
            processedAt: new Date(),
          },
        }
      );
      failed += 1;
    }
  }

  return { processed, failed, scanned: pending.length };
}

module.exports = {
  handleInboundWebhook,
  replayPendingInbound,
  buildInboundMessageFields,
  verifyGupshupWebhookRequest,
};
