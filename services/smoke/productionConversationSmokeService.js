'use strict';

/**
 * Production conversation smoke — injects a synthetic inbound into the SAME pipeline
 * WhatsApp uses (getOrCreateConversation → inbound row → executeClaimedInboundProcessing
 * → processInbound → whatsappOutboundService → gupshupSession.sendTextMessage).
 *
 * No mocks. No test hooks. No alternate chatbot implementation.
 */

const crypto = require('crypto');
const WhatsAppInboundMessage = require('../../models/WhatsAppInboundMessage');
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const WhatsAppWebhookEvent = require('../../models/WhatsAppWebhookEvent');
const WhatsAppConversation = require('../../models/WhatsAppConversation');
const { sanitizeInboundSnippet } = require('../../utils/gupshupInboundPayload');
const { maskPhoneTail } = require('../../utils/chatbotPhone');
const { getOrCreateConversation, touchInbound } = require('../chatbot/conversationService');
const { resetToMainMenu } = require('../chatbot/botStateService');
const {
  executeClaimedInboundProcessing,
  findSuccessfulBotReply,
} = require('../chatbot/whatsappInboundService');
const {
  isGupshupOutboundConfigured,
  isIntegrationStubEnabled,
} = require('../../utils/gupshupCredentialValidation');

function normalizePhone10(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * @param {{ phone: string, message: string, resetState?: boolean, caseId?: string|null }} opts
 */
async function runProductionConversationSmokeSend(opts = {}) {
  const phone10 = normalizePhone10(opts.phone);
  const message = String(opts.message ?? '').trim();
  const resetState = opts.resetState !== false;
  const caseId = opts.caseId ? String(opts.caseId).slice(0, 64) : null;
  const startedAt = Date.now();

  if (!phone10 || phone10.length !== 10) {
    const err = new Error('phone must be a 10-digit Indian mobile');
    err.statusCode = 400;
    throw err;
  }
  if (!message) {
    const err = new Error('message is required');
    err.statusCode = 400;
    throw err;
  }
  if (message.length > 4000) {
    const err = new Error('message too long');
    err.statusCode = 400;
    throw err;
  }

  if (isIntegrationStubEnabled()) {
    const err = new Error('WA_INTEGRATION_STUB=1 — real WhatsApp delivery required');
    err.statusCode = 503;
    throw err;
  }
  if (!isGupshupOutboundConfigured()) {
    const err = new Error('Gupshup outbound not configured on this deployment');
    err.statusCode = 503;
    throw err;
  }

  const receivedAt = new Date();
  const smokeNonce = crypto.randomBytes(12).toString('hex');
  const providerMessageId = `smoke:${smokeNonce}`;
  const dedupeKey = `prod_smoke:${phone10}:${smokeNonce}`;

  const { conversation, leadLinks } = await getOrCreateConversation(phone10);

  if (resetState) {
    await resetToMainMenu(conversation._id, phone10, { reason: 'production_conversation_smoke' });
    await WhatsAppConversation.updateOne(
      { _id: conversation._id },
      { $set: { status: 'active', currentHandoffId: null } }
    );
  }

  const freshConversation = await WhatsAppConversation.findById(conversation._id);
  const smokePayload = {
    source: 'production_conversation_smoke',
    caseId,
    phone10,
    text: message,
    providerMessageId,
  };

  let webhookEvent;
  try {
    webhookEvent = await WhatsAppWebhookEvent.create({
      eventKind: 'inbound',
      webhookDedupeKey: `smoke:${dedupeKey}`,
      receivedAt,
      phone: phone10,
      status: 'inbound',
      rawPayloadSnippet: sanitizeInboundSnippet(smokePayload, 1500),
      matchedBy: 'production_smoke',
      matchConfidence: 'high',
    });
  } catch (e) {
    if (e && (e.code === 11000 || String(e.message).includes('E11000'))) {
      const err = new Error('smoke dedupe collision — retry');
      err.statusCode = 409;
      throw err;
    }
    throw e;
  }

  const inboundDoc = await WhatsAppInboundMessage.create({
    conversationId: freshConversation._id,
    phone: phone10,
    providerMessageId,
    messageType: 'text',
    text: message,
    interactivePayload: null,
    mediaUrl: null,
    location: null,
    rawPayloadSnippet: sanitizeInboundSnippet(smokePayload, 1500),
    receivedAt,
    processStatus: 'pending',
    dedupeKey,
    whatsappWebhookEventId: webhookEvent._id,
  });

  await WhatsAppWebhookEvent.updateOne(
    { _id: webhookEvent._id },
    { $set: { inboundMessageId: inboundDoc._id } }
  );
  await touchInbound(freshConversation._id, receivedAt);

  console.log(
    JSON.stringify({
      event: 'internal_smoke_pipeline_start',
      phone_tail: maskPhoneTail(phone10),
      caseId,
      inboundId: String(inboundDoc._id),
      resetState,
    })
  );

  let processResult;
  try {
    processResult = await executeClaimedInboundProcessing({
      conversation: freshConversation,
      inbound: inboundDoc,
      leadLinks,
      phone10,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'internal_smoke_pipeline_error',
        phone_tail: maskPhoneTail(phone10),
        caseId,
        inboundId: String(inboundDoc._id),
        error: String(err.message || err).slice(0, 500),
      })
    );
    throw err;
  }

  let outbound =
    (await WhatsAppOutboundMessage.findOne({
      inReplyToInboundId: inboundDoc._id,
      senderType: 'bot',
    })
      .sort({ createdAt: -1 })
      .lean()) || null;

  if (!outbound) {
    const existing = await findSuccessfulBotReply(inboundDoc._id);
    if (existing) {
      outbound = await WhatsAppOutboundMessage.findById(existing._id).lean();
    }
  }

  const durationMs = Date.now() - startedAt;
  const response = {
    success: Boolean(
      processResult &&
        (processResult.outboundSuccess === true ||
          processResult.delivered === true ||
          (outbound && outbound.gupshupMessageId))
    ),
    phone: phone10,
    caseId,
    inboundId: String(inboundDoc._id),
    conversationId: String(freshConversation._id),
    outboundId: outbound ? String(outbound._id) : processResult?.outboundMessageId || null,
    gupshupMessageId: outbound?.gupshupMessageId || null,
    outboundStatus: outbound?.status || null,
    intent: processResult?.intent || null,
    outboundSuccess: processResult?.outboundSuccess ?? null,
    processSkipped: Boolean(processResult?.skipped),
    processReason: processResult?.reason || processResult?.error || null,
    durationMs,
    pipeline: 'executeClaimedInboundProcessing→processInbound→whatsappOutbound→gupshupSession',
  };

  console.log(
    JSON.stringify({
      event: 'internal_smoke_pipeline_done',
      phone_tail: maskPhoneTail(phone10),
      caseId,
      inboundId: response.inboundId,
      outboundId: response.outboundId,
      outboundStatus: response.outboundStatus,
      gupshupMessageIdPresent: Boolean(response.gupshupMessageId),
      success: response.success,
      durationMs,
    })
  );

  return response;
}

module.exports = {
  runProductionConversationSmokeSend,
  normalizePhone10,
};
