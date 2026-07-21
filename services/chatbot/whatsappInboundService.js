const WhatsAppInboundMessage = require('../../models/WhatsAppInboundMessage');
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const WhatsAppWebhookEvent = require('../../models/WhatsAppWebhookEvent');
const {
  parseInboundWebhook,
  buildInboundDedupeKey,
  inboundDedupeBucketSec,
  sanitizeInboundSnippet,
} = require('../../utils/gupshupInboundPayload');
const { maskPhoneTail } = require('../../utils/chatbotPhone');
const { verifyGupshupWebhookRequest } = require('../../utils/gupshupWebhookAuth');
const { getOrCreateConversation, touchInbound } = require('./conversationService');
const { processInbound } = require('./chatbotOrchestratorService');
const { DEFAULT_TIMEOUT_MS } = require('./knowledgeAssistantService');

const rateLimitMap = new Map();

const SUCCESSFUL_OUTBOUND_STATUSES = ['queued', 'submitted', 'sent', 'delivered', 'read'];

function normalizeInboundText(text) {
  return String(text || '').trim().toLowerCase();
}

/**
 * Catch dual-provider / delayed redelivery when content-hash buckets differ
 * (e.g. Gupshup uses server clock, Meta uses message timestamp).
 */
async function findRecentSameUtterance(phone10, text, at = new Date()) {
  const textNorm = normalizeInboundText(text);
  if (!phone10 || !textNorm) return null;

  const windowMs = Math.max(45, inboundDedupeBucketSec()) * 1000;
  const since = new Date(at.getTime() - windowMs);
  const recent = await WhatsAppInboundMessage.find({
    phone: phone10,
    receivedAt: { $gte: since },
  })
    .select('_id text receivedAt')
    .sort({ receivedAt: -1 })
    .limit(25)
    .lean();

  return recent.find((row) => normalizeInboundText(row.text) === textNorm) || null;
}

function inboundProcessingStaleMs() {
  const configured = Number(process.env.CHATBOT_INBOUND_PROCESSING_STALE_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  const kaTimeout = Number(process.env.KNOWLEDGE_ASSISTANT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  return Math.max(120000, kaTimeout * 2);
}

function resolveInboundProcessUpdate(result) {
  if (result && result.skipped && result.reason === 'already_processing') {
    return {
      processStatus: 'processing',
      processError: null,
    };
  }
  if (result && (result.outboundSuccess === true || result.delivered === true)) {
    return {
      processStatus: 'processed',
      processError: null,
    };
  }
  if (result && result.handoff) {
    return {
      processStatus: 'processed',
      processError: null,
    };
  }
  const err =
    (result && (result.error || result.errMessage)) || 'outbound_send_failed';
  return {
    processStatus: 'pending',
    processError: String(err).slice(0, 2000),
  };
}

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
 * Atomically claim a pending inbound row for processing.
 * @returns {Promise<object|null>}
 */
async function claimInboundForProcessing(inboundId) {
  return WhatsAppInboundMessage.findOneAndUpdate(
    { _id: inboundId, processStatus: 'pending' },
    { $set: { processStatus: 'processing', updatedAt: new Date() } },
    { new: true, lean: true }
  );
}

/**
 * Reset stale processing rows so cron can retry them.
 */
async function recoverStaleProcessingInbound(limit = 50) {
  const cutoff = new Date(Date.now() - inboundProcessingStaleMs());
  const stale = await WhatsAppInboundMessage.find({
    processStatus: 'processing',
    updatedAt: { $lt: cutoff },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .select('_id')
    .lean();

  if (stale.length === 0) {
    return { recovered: 0 };
  }

  const ids = stale.map((row) => row._id);
  const result = await WhatsAppInboundMessage.updateMany(
    { _id: { $in: ids }, processStatus: 'processing' },
    {
      $set: {
        processStatus: 'pending',
        processError: 'processing_stale_recovered',
        updatedAt: new Date(),
      },
    }
  );

  return { recovered: result.modifiedCount || 0 };
}

async function markInboundProcessedFromExistingReply(inboundId) {
  await WhatsAppInboundMessage.updateOne(
    { _id: inboundId },
    {
      $set: {
        processStatus: 'processed',
        processError: null,
        processedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
}

async function findSuccessfulBotReply(inboundId) {
  return WhatsAppOutboundMessage.findOne({
    inReplyToInboundId: inboundId,
    senderType: 'bot',
    status: { $in: SUCCESSFUL_OUTBOUND_STATUSES },
  })
    .select('_id status')
    .lean();
}

/**
 * Run processInbound once for a claimed inbound row.
 */
async function executeClaimedInboundProcessing({ conversation, inbound, leadLinks, phone10 }) {
  const inboundId = inbound._id || inbound.id;
  const claimed = await claimInboundForProcessing(inboundId);
  if (!claimed) {
    const existingReply = await findSuccessfulBotReply(inboundId);
    if (existingReply) {
      await markInboundProcessedFromExistingReply(inboundId);
      return {
        skipped: true,
        reason: 'already_replied',
        outboundSuccess: true,
        delivered: true,
      };
    }
    return { skipped: true, reason: 'already_processing' };
  }

  try {
    const result = await processInbound({
      conversation,
      inbound: claimed,
      leadLinks,
    });
    const processUpdate = resolveInboundProcessUpdate(result);
    if (processUpdate.processStatus === 'pending') {
      console.error('[chatbot] outbound_send_failed', {
        phone_tail: maskPhoneTail(phone10 || conversation.phone),
        inbound_id: String(inboundId),
        error: processUpdate.processError,
      });
    }
    await WhatsAppInboundMessage.updateOne(
      { _id: inboundId },
      {
        $set: {
          processStatus: processUpdate.processStatus,
          processError: processUpdate.processError,
          processedAt:
            processUpdate.processStatus === 'processed' ? new Date() : null,
          updatedAt: new Date(),
        },
      }
    );
    return result;
  } catch (err) {
    console.error('[chatbot] process error', maskPhoneTail(phone10 || conversation.phone), err.message);
    await WhatsAppInboundMessage.updateOne(
      { _id: inboundId },
      {
        $set: {
          processStatus: 'failed',
          processError: String(err.message).slice(0, 2000),
          processedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    throw err;
  }
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

  // Prefer webhook arrival time for bucket stability across providers.
  const parsedForDedupe = { ...parsed, receivedAt };
  let dedupeKey = buildInboundDedupeKey(parsedForDedupe, body);

  const recentSame = await findRecentSameUtterance(parsed.phone10, parsed.text, receivedAt);
  if (recentSame) {
    console.warn('[chatbot] inbound_dedupe_recent_same_utterance', {
      phone: maskPhoneTail(parsed.phone10),
      existingInboundId: String(recentSame._id),
    });
    return { handled: true, dedupe: true, reason: 'recent_same_utterance' };
  }

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
      // Content-hash collision: Gupshup + Meta dual delivery of the same utterance.
      // Never create a second inbound/provider-scoped key — that caused duplicate bot replies.
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
  } catch (e) {
    if (e && (e.code === 11000 || String(e.message).includes('E11000'))) {
      return { handled: true, dedupe: true, webhookEventId: webhookEvent?._id };
    }
    throw e;
  }

  await WhatsAppWebhookEvent.updateOne(
    { _id: webhookEvent._id },
    { $set: { inboundMessageId: inboundDoc._id } }
  );

  await touchInbound(conversation._id, receivedAt);

  try {
    await executeClaimedInboundProcessing({
      conversation,
      inbound: inboundDoc,
      leadLinks,
      phone10: parsed.phone10,
    });
  } catch (_err) {
    // executeClaimedInboundProcessing already persisted failed status
  }

  return { handled: true, inboundId: String(inboundDoc._id) };
}

/**
 * Replay pending inbound messages (cron).
 */
async function replayPendingInbound(limit = 30) {
  await recoverStaleProcessingInbound();

  const pending = await WhatsAppInboundMessage.find({ processStatus: 'pending' })
    .sort({ receivedAt: 1 })
    .limit(limit)
    .lean();

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of pending) {
    try {
      if (!row.conversationId) {
        continue;
      }

      const existingReply = await findSuccessfulBotReply(row._id);
      if (existingReply) {
        await markInboundProcessedFromExistingReply(row._id);
        processed += 1;
        continue;
      }

      const conversation = await require('../../models/WhatsAppConversation').findById(
        row.conversationId
      );
      if (!conversation) continue;

      const { resolveLeadLinks } = require('../../utils/chatbotPhone');
      const leadLinks = await resolveLeadLinks(row.phone);
      const result = await executeClaimedInboundProcessing({
        conversation,
        inbound: row,
        leadLinks,
        phone10: row.phone,
      });

      if (result && result.skipped) {
        skipped += 1;
        continue;
      }

      const processUpdate = resolveInboundProcessUpdate(result);
      if (processUpdate.processStatus === 'processed') {
        processed += 1;
      } else if (processUpdate.processStatus === 'failed') {
        failed += 1;
      } else {
        failed += 1;
      }
    } catch (_e) {
      failed += 1;
    }
  }

  return { processed, failed, skipped, scanned: pending.length };
}

module.exports = {
  handleInboundWebhook,
  replayPendingInbound,
  buildInboundMessageFields,
  verifyGupshupWebhookRequest,
  resolveInboundProcessUpdate,
  claimInboundForProcessing,
  recoverStaleProcessingInbound,
  executeClaimedInboundProcessing,
  inboundProcessingStaleMs,
  findSuccessfulBotReply,
};
