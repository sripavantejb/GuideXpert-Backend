const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const { parseGupshupTemplateSendResponse } = require('../../utils/gupshupMessageIds');
const { maskPhoneTail } = require('../../utils/chatbotPhone');
const { isMongoDuplicateKeyError } = require('../../utils/mongoDuplicateKey');
const gupshupSession = require('./gupshupSessionService');
const { sendSessionInactiveTemplateFallback } = require('./sessionFallbackService');

/** Statuses that must not be re-sent (queued includes in-flight create-owns-send). */
const SUCCESSFUL_OUTBOUND_STATUSES = ['queued', 'submitted', 'sent', 'delivered', 'read', 'simulated'];

function isReengagementSendError(error) {
  const msg = String(error || '').toLowerCase();
  return (
    msg.includes('re-engagement') ||
    msg.includes('reengagement') ||
    msg.includes('131047')
  );
}

async function attemptSessionFallbackOnFailure(phone10, result) {
  if (!result || result.success || !isReengagementSendError(result.error)) {
    return null;
  }
  const fallback = await sendSessionInactiveTemplateFallback(phone10);
  if (!fallback.success) {
    console.warn('[chatbot] session_fallback_failed', {
      phone_tail: maskPhoneTail(phone10),
      error: fallback.error || 'send failed',
    });
    return null;
  }
  console.log(
    JSON.stringify({
      event: 'session_fallback_sent',
      phone_tail: maskPhoneTail(phone10),
      reason: 're_engagement',
    })
  );
  return fallback;
}

function logOutboundFailure(phone10, messageType, result) {
  console.error('[chatbot] outbound_send_failed', {
    phone_tail: maskPhoneTail(phone10),
    message_type: messageType,
    error: (result && result.error) || 'send failed',
  });
}

function snippetFromResult(result, max = 1000) {
  if (!result || result.data == null) return null;
  try {
    const s = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return null;
  }
}

function normalizePartIndex(partIndex) {
  const n = Number(partIndex);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

async function findExistingBotReply(inReplyToInboundId, partIndex) {
  if (!inReplyToInboundId) return null;
  return WhatsAppOutboundMessage.findOne({
    inReplyToInboundId,
    partIndex: normalizePartIndex(partIndex),
    senderType: 'bot',
  }).lean();
}

async function findSuccessfulBotReply(inReplyToInboundId, partIndex) {
  if (!inReplyToInboundId) return null;
  return WhatsAppOutboundMessage.findOne({
    inReplyToInboundId,
    partIndex: normalizePartIndex(partIndex),
    senderType: 'bot',
    status: { $in: SUCCESSFUL_OUTBOUND_STATUSES },
  }).lean();
}

/**
 * Create owns send. Concurrent create on the same (inbound, partIndex) tuple:
 * - queued / successful → duplicatePrevented (no re-send)
 * - failed → atomic failed→queued claim; only the claimant retries
 */
async function createOrClaimBotOutbound({
  conversationId,
  phone10,
  messageType,
  content,
  textPreview,
  inReplyToInboundId = null,
  partIndex = 0,
  handoffId = null,
}) {
  const normalizedPartIndex = normalizePartIndex(partIndex);
  const now = new Date();

  if (inReplyToInboundId) {
    const existingSuccess = await findSuccessfulBotReply(inReplyToInboundId, normalizedPartIndex);
    if (existingSuccess) {
      return {
        outbound: existingSuccess,
        duplicatePrevented: true,
        newlySent: false,
        partIndex: normalizedPartIndex,
      };
    }
  }

  const createDoc = {
    conversationId,
    phone: phone10,
    senderType: 'bot',
    messageType,
    content,
    textPreview,
    status: 'queued',
    inReplyToInboundId: inReplyToInboundId || null,
    partIndex: normalizedPartIndex,
    handoffId: handoffId || null,
  };

  try {
    const outbound = await WhatsAppOutboundMessage.create(createDoc);
    return {
      outbound,
      duplicatePrevented: false,
      newlySent: true,
      partIndex: normalizedPartIndex,
    };
  } catch (err) {
    if (!isMongoDuplicateKeyError(err) || !inReplyToInboundId) {
      throw err;
    }

    const claimed = await WhatsAppOutboundMessage.findOneAndUpdate(
      {
        inReplyToInboundId,
        partIndex: normalizedPartIndex,
        senderType: 'bot',
        status: 'failed',
      },
      {
        $set: {
          content,
          textPreview,
          status: 'queued',
          messageType,
          handoffId: handoffId || null,
          webhookErrorReason: null,
          webhookErrorCode: null,
          failedAt: null,
          updatedAt: now,
        },
      },
      { new: true }
    );

    if (claimed) {
      return {
        outbound: claimed,
        duplicatePrevented: false,
        newlySent: true,
        partIndex: normalizedPartIndex,
      };
    }

    const existing = await findExistingBotReply(inReplyToInboundId, normalizedPartIndex);
    if (existing) {
      return {
        outbound: existing,
        duplicatePrevented: true,
        newlySent: false,
        partIndex: normalizedPartIndex,
      };
    }
    throw err;
  }
}

async function markBotOutboundSubmitted(outboundId, result, ids) {
  const nowUp = new Date();
  const status = result && result.stub ? 'simulated' : 'submitted';
  await WhatsAppOutboundMessage.updateOne(
    { _id: outboundId },
    {
      $set: {
        status,
        gupshupMessageId: ids.canonicalMessageId || null,
        gupshupInternalMessageId: ids.gupshupInternalMessageId || null,
        whatsappWaMessageId: ids.whatsappWaMessageId || null,
        providerPayloadSnippet: snippetFromResult(result),
        sentAt: nowUp,
        updatedAt: nowUp,
      },
    }
  );
  return status;
}

async function markBotOutboundFailed(outboundId, result) {
  const nowUp = new Date();
  await WhatsAppOutboundMessage.updateOne(
    { _id: outboundId },
    {
      $set: {
        status: 'failed',
        webhookErrorReason: (result && result.error) || 'send failed',
        providerPayloadSnippet: snippetFromResult(result),
        failedAt: nowUp,
        updatedAt: nowUp,
      },
    }
  );
}

/**
 * Mark failed, then optionally promote to submitted on session-template fallback
 * so a later webhook retry does not reclaim the row as a failed send.
 */
async function finishBotSendFailure(phone10, messageType, outbound, result) {
  await markBotOutboundFailed(outbound._id, result);
  logOutboundFailure(phone10, messageType, result);
  const fallback = await attemptSessionFallbackOnFailure(phone10, result);
  if (fallback && fallback.success) {
    const nowUp = new Date();
    await WhatsAppOutboundMessage.updateOne(
      { _id: outbound._id },
      {
        $set: {
          status: 'submitted',
          webhookErrorReason: null,
          failedAt: null,
          sentAt: nowUp,
          updatedAt: nowUp,
          providerPayloadSnippet: snippetFromResult(fallback) || snippetFromResult(result),
        },
      }
    );
    return {
      success: true,
      outboundId: outbound._id,
      sessionFallback: true,
      newlySent: true,
      partIndex: outbound.partIndex,
      result: fallback,
    };
  }
  return {
    success: false,
    outboundId: outbound._id,
    error: result && result.error,
    newlySent: true,
    partIndex: outbound.partIndex,
    result,
  };
}

function duplicatePreventedResult(outbound, partIndex) {
  return {
    success: true,
    outboundId: outbound._id,
    duplicatePrevented: true,
    newlySent: false,
    partIndex: normalizePartIndex(partIndex ?? outbound.partIndex),
  };
}

/**
 * Send bot text reply and persist outbound row.
 */
async function sendBotTextReply({
  conversationId,
  phone10,
  text,
  inReplyToInboundId = null,
  partIndex = 0,
  handoffId = null,
  messageType = 'text',
}) {
  const claim = await createOrClaimBotOutbound({
    conversationId,
    phone10,
    messageType,
    content: { type: 'text', text },
    textPreview: String(text || '').slice(0, 500),
    inReplyToInboundId,
    partIndex,
    handoffId,
  });
  if (claim.duplicatePrevented) {
    return duplicatePreventedResult(claim.outbound, claim.partIndex);
  }

  const outbound = claim.outbound;
  const result = await gupshupSession.sendTextMessage(phone10, text);
  const ids = parseGupshupTemplateSendResponse(result && result.data);

  if (result && result.success) {
    await markBotOutboundSubmitted(outbound._id, result, ids);
    return {
      success: true,
      outboundId: outbound._id,
      newlySent: true,
      partIndex: claim.partIndex,
      result,
    };
  }

  return finishBotSendFailure(phone10, messageType, outbound, result);
}

async function sendBotButtonReply({
  conversationId,
  phone10,
  body,
  buttons,
  inReplyToInboundId = null,
  partIndex = 0,
}) {
  const claim = await createOrClaimBotOutbound({
    conversationId,
    phone10,
    messageType: 'interactive_button',
    content: { type: 'interactive_button', body, buttons },
    textPreview: String(body || '').slice(0, 500),
    inReplyToInboundId,
    partIndex,
  });
  if (claim.duplicatePrevented) {
    return duplicatePreventedResult(claim.outbound, claim.partIndex);
  }

  const outbound = claim.outbound;
  const result = await gupshupSession.sendButtonMessage(phone10, body, buttons);
  const ids = parseGupshupTemplateSendResponse(result && result.data);

  if (result && result.success) {
    await markBotOutboundSubmitted(outbound._id, result, ids);
    return {
      success: true,
      outboundId: outbound._id,
      newlySent: true,
      partIndex: claim.partIndex,
    };
  }

  return finishBotSendFailure(phone10, 'interactive_button', outbound, result);
}

async function sendAgentTextReply({
  conversationId,
  phone10,
  text,
  senderAdminId = null,
  senderBdaId = null,
  handoffId = null,
  copilotReplyId = null,
}) {
  if (copilotReplyId) {
    const existingSuccess = await WhatsAppOutboundMessage.findOne({
      copilotReplyId,
      status: { $in: SUCCESSFUL_OUTBOUND_STATUSES },
    }).lean();
    if (existingSuccess) {
      return {
        success: true,
        outboundId: existingSuccess._id,
        duplicatePrevented: true,
        providerStatus: existingSuccess.status,
        deliveryStatus: existingSuccess.status,
        stub: existingSuccess.status === 'simulated',
      };
    }
  }

  const outbound = await WhatsAppOutboundMessage.create({
    conversationId,
    phone: phone10,
    senderType: 'agent',
    senderAdminId: senderAdminId || null,
    senderBdaId: senderBdaId || null,
    messageType: 'text',
    content: { type: 'text', text },
    textPreview: String(text || '').slice(0, 500),
    status: 'queued',
    handoffId: handoffId || null,
    copilotReplyId: copilotReplyId || null,
  });

  const result = await gupshupSession.sendTextMessage(phone10, text);
  const ids = parseGupshupTemplateSendResponse(result && result.data);
  const nowUp = new Date();

  if (result && result.success) {
    const outboundStatus = result.stub ? 'simulated' : 'submitted';
    await WhatsAppOutboundMessage.updateOne(
      { _id: outbound._id },
      {
        $set: {
          status: outboundStatus,
          gupshupMessageId: ids.canonicalMessageId || null,
          gupshupInternalMessageId: ids.gupshupInternalMessageId || null,
          whatsappWaMessageId: ids.whatsappWaMessageId || null,
          providerPayloadSnippet: snippetFromResult(result),
          sentAt: nowUp,
          updatedAt: nowUp,
        },
      }
    );
    return {
      success: true,
      outboundId: outbound._id,
      stub: Boolean(result.stub),
      providerStatus: outboundStatus,
      deliveryStatus: outboundStatus,
      sessionFallback: false,
    };
  }

  await WhatsAppOutboundMessage.updateOne(
    { _id: outbound._id },
    {
      $set: {
        status: 'failed',
        webhookErrorReason: (result && result.error) || 'send failed',
        failedAt: nowUp,
        updatedAt: nowUp,
      },
    }
  );
  logOutboundFailure(phone10, 'agent_text', result);
  const fallback = await attemptSessionFallbackOnFailure(phone10, result);
  if (fallback && fallback.success) {
    // Promote off failed so webhook retries do not treat template fallback as reclaimable.
    await WhatsAppOutboundMessage.updateOne(
      { _id: outbound._id },
      {
        $set: {
          status: 'submitted',
          webhookErrorReason: null,
          failedAt: null,
          sentAt: nowUp,
          updatedAt: nowUp,
        },
      }
    );
    return {
      success: true,
      outboundId: outbound._id,
      sessionFallback: true,
      providerStatus: 'submitted',
      deliveryStatus: 'submitted',
    };
  }
  return {
    success: false,
    outboundId: outbound._id,
    error: result && result.error,
    providerStatus: 'failed',
    deliveryStatus: 'failed',
  };
}

/**
 * Send a bot image (optionally captioned) and persist the outbound row.
 * Multipart envelopes pass inReplyToInboundId + partIndex like text/interactive.
 */
async function sendBotImageReply({
  conversationId,
  phone10,
  url,
  caption = null,
  inReplyToInboundId = null,
  partIndex = 0,
}) {
  const claim = await createOrClaimBotOutbound({
    conversationId,
    phone10,
    messageType: 'image',
    content: { type: 'image', url, caption },
    textPreview: String(caption || url || '').slice(0, 500),
    inReplyToInboundId,
    partIndex,
  });
  if (claim.duplicatePrevented) {
    return duplicatePreventedResult(claim.outbound, claim.partIndex);
  }

  const outbound = claim.outbound;
  const result = await gupshupSession.sendImageMessage(phone10, url, caption);
  const ids = parseGupshupTemplateSendResponse(result && result.data);

  if (result && result.success) {
    await markBotOutboundSubmitted(outbound._id, result, ids);
    return {
      success: true,
      outboundId: outbound._id,
      newlySent: true,
      partIndex: claim.partIndex,
    };
  }

  return finishBotSendFailure(phone10, 'image', outbound, result);
}

async function sendBotListReply({
  conversationId,
  phone10,
  body,
  buttonText,
  sections,
  title,
  inReplyToInboundId = null,
  partIndex = 0,
}) {
  const claim = await createOrClaimBotOutbound({
    conversationId,
    phone10,
    messageType: 'interactive_list',
    content: { type: 'interactive_list', body, buttonText, sections, title },
    textPreview: String(body || '').slice(0, 500),
    inReplyToInboundId,
    partIndex,
  });
  if (claim.duplicatePrevented) {
    return duplicatePreventedResult(claim.outbound, claim.partIndex);
  }

  const outbound = claim.outbound;
  const result = await gupshupSession.sendListMessage(phone10, body, buttonText, sections, {
    title,
  });
  const ids = parseGupshupTemplateSendResponse(result && result.data);

  if (result && result.success) {
    await markBotOutboundSubmitted(outbound._id, result, ids);
    return {
      success: true,
      outboundId: outbound._id,
      newlySent: true,
      partIndex: claim.partIndex,
    };
  }

  return finishBotSendFailure(phone10, 'interactive_list', outbound, result);
}

module.exports = {
  sendBotTextReply,
  sendBotButtonReply,
  sendBotListReply,
  sendBotImageReply,
  sendAgentTextReply,
  isReengagementSendError,
  normalizePartIndex,
  SUCCESSFUL_OUTBOUND_STATUSES,
};
