const mongoose = require('mongoose');
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const { parseGupshupTemplateSendResponse } = require('../../utils/gupshupMessageIds');
const gupshupSession = require('./gupshupSessionService');

function snippetFromResult(result, max = 1000) {
  if (!result || result.data == null) return null;
  try {
    const s = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return null;
  }
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
  const now = new Date();
  const outbound = await WhatsAppOutboundMessage.create({
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
  return { success: false, outboundId: outbound._id, error: result && result.error };
}

/**
 * Agent reply (admin or BDA) during handoff.
 */
async function sendAgentTextReply({
  conversationId,
  phone10,
  text,
  senderAdminId = null,
  senderBdaId = null,
  handoffId = null,
}) {
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
  });

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
  return { success: false, outboundId: outbound._id, error: result && result.error };
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
  return { success: false, outboundId: outbound._id, error: result && result.error };
}

module.exports = {
  sendBotTextReply,
  sendBotButtonReply,
  sendBotListReply,
  sendAgentTextReply,
};
