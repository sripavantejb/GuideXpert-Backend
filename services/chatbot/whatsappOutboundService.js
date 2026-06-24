const mongoose = require('mongoose');
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const { parseGupshupTemplateSendResponse } = require('../../utils/gupshupMessageIds');
const { maskPhoneTail } = require('../../utils/chatbotPhone');
const { isMongoDuplicateKeyError } = require('../../utils/mongoDuplicateKey');
const gupshupSession = require('./gupshupSessionService');
const { sendSessionInactiveTemplateFallback } = require('./sessionFallbackService');

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

async function findExistingBotReply(inReplyToInboundId) {
  if (!inReplyToInboundId) return null;
  return WhatsAppOutboundMessage.findOne({
    inReplyToInboundId,
    senderType: 'bot',
  }).lean();
}

async function findSuccessfulBotReply(inReplyToInboundId) {
  if (!inReplyToInboundId) return null;
  return WhatsAppOutboundMessage.findOne({
    inReplyToInboundId,
    senderType: 'bot',
    status: { $in: SUCCESSFUL_OUTBOUND_STATUSES },
  }).lean();
}

/**
 * Send bot text reply and persist outbound row.
 */
async function sendBotTextReply({
  conversationId,
  phone10,
  text,
  inReplyToInboundId = null,
  handoffId = null,
  messageType = 'text',
}) {
  if (inReplyToInboundId) {
    const existingSuccess = await findSuccessfulBotReply(inReplyToInboundId);
    if (existingSuccess) {
      return {
        success: true,
        outboundId: existingSuccess._id,
        duplicatePrevented: true,
      };
    }
  }

  const now = new Date();
  let outbound;
  try {
    outbound = await WhatsAppOutboundMessage.create({
      conversationId,
      phone: phone10,
      senderType: 'bot',
      messageType,
      content: { type: 'text', text },
      textPreview: String(text || '').slice(0, 500),
      status: 'queued',
      inReplyToInboundId: inReplyToInboundId || null,
      handoffId: handoffId || null,
    });
  } catch (err) {
    if (isMongoDuplicateKeyError(err) && inReplyToInboundId) {
      const existing = await findExistingBotReply(inReplyToInboundId);
      if (existing) {
        if (SUCCESSFUL_OUTBOUND_STATUSES.includes(existing.status)) {
          return {
            success: true,
            outboundId: existing._id,
            duplicatePrevented: true,
          };
        }
        outbound = existing;
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (outbound.status !== 'queued') {
    await WhatsAppOutboundMessage.updateOne(
      { _id: outbound._id },
      {
        $set: {
          content: { type: 'text', text },
          textPreview: String(text || '').slice(0, 500),
          status: 'queued',
          messageType,
          handoffId: handoffId || null,
          updatedAt: now,
        },
      }
    );
  }

  const result = await gupshupSession.sendTextMessage(phone10, text);
  const ids = parseGupshupTemplateSendResponse(result && result.data);
  const nowUp = new Date();

  if (result && result.success) {
    await WhatsAppOutboundMessage.updateOne(
      { _id: outbound._id },
      {
        $set: {
          status: 'submitted',
          gupshupMessageId: ids.canonicalMessageId || null,
          gupshupInternalMessageId: ids.gupshupInternalMessageId || null,
          whatsappWaMessageId: ids.whatsappWaMessageId || null,
          providerPayloadSnippet: snippetFromResult(result),
          sentAt: nowUp,
          updatedAt: nowUp,
        },
      }
    );
    return { success: true, outboundId: outbound._id, result };
  }

  await WhatsAppOutboundMessage.updateOne(
    { _id: outbound._id },
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
  logOutboundFailure(phone10, messageType, result);
  const fallback = await attemptSessionFallbackOnFailure(phone10, result);
  if (fallback && fallback.success) {
    return {
      success: true,
      outboundId: outbound._id,
      sessionFallback: true,
      result: fallback,
    };
  }
  return { success: false, outboundId: outbound._id, error: result && result.error, result };
}

async function sendBotButtonReply({ conversationId, phone10, body, buttons, inReplyToInboundId }) {
  const outbound = await WhatsAppOutboundMessage.create({
    conversationId,
    phone: phone10,
    senderType: 'bot',
    messageType: 'interactive_button',
    content: { type: 'interactive_button', body, buttons },
    textPreview: String(body || '').slice(0, 500),
    status: 'queued',
    inReplyToInboundId: inReplyToInboundId || null,
  });

  const result = await gupshupSession.sendButtonMessage(phone10, body, buttons);
  const ids = parseGupshupTemplateSendResponse(result && result.data);
  const nowUp = new Date();

  if (result && result.success) {
    await WhatsAppOutboundMessage.updateOne(
      { _id: outbound._id },
      {
        $set: {
          status: 'submitted',
          gupshupMessageId: ids.canonicalMessageId || null,
          gupshupInternalMessageId: ids.gupshupInternalMessageId || null,
          whatsappWaMessageId: ids.whatsappWaMessageId || null,
          providerPayloadSnippet: snippetFromResult(result),
          sentAt: nowUp,
          updatedAt: nowUp,
        },
      }
    );
    return { success: true, outboundId: outbound._id };
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
  logOutboundFailure(phone10, 'interactive_button', result);
  const fallback = await attemptSessionFallbackOnFailure(phone10, result);
  if (fallback && fallback.success) {
    return { success: true, outboundId: outbound._id, sessionFallback: true };
  }
  return { success: false, outboundId: outbound._id, error: result && result.error };
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

async function sendBotListReply({
  conversationId,
  phone10,
  body,
  buttonText,
  sections,
  inReplyToInboundId,
}) {
  const outbound = await WhatsAppOutboundMessage.create({
    conversationId,
    phone: phone10,
    senderType: 'bot',
    messageType: 'interactive_list',
    content: { type: 'interactive_list', body, buttonText, sections },
    textPreview: String(body || '').slice(0, 500),
    status: 'queued',
    inReplyToInboundId: inReplyToInboundId || null,
  });

  const result = await gupshupSession.sendListMessage(phone10, body, buttonText, sections);
  const ids = parseGupshupTemplateSendResponse(result && result.data);
  const nowUp = new Date();

  if (result && result.success) {
    await WhatsAppOutboundMessage.updateOne(
      { _id: outbound._id },
      {
        $set: {
          status: 'submitted',
          gupshupMessageId: ids.canonicalMessageId || null,
          gupshupInternalMessageId: ids.gupshupInternalMessageId || null,
          whatsappWaMessageId: ids.whatsappWaMessageId || null,
          providerPayloadSnippet: snippetFromResult(result),
          sentAt: nowUp,
          updatedAt: nowUp,
        },
      }
    );
    return { success: true, outboundId: outbound._id };
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
  logOutboundFailure(phone10, 'interactive_list', result);
  const fallback = await attemptSessionFallbackOnFailure(phone10, result);
  if (fallback && fallback.success) {
    return { success: true, outboundId: outbound._id, sessionFallback: true };
  }
  return { success: false, outboundId: outbound._id, error: result && result.error };
}

module.exports = {
  sendBotTextReply,
  sendBotButtonReply,
  sendBotListReply,
  sendAgentTextReply,
  isReengagementSendError,
};
