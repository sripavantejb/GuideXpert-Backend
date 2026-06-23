/**
 * Gupshup session messages (wa/api/v1/msg) — 24h customer care window.
 */
const axios = require('axios');
const { formatPhoneE16491 } = require('../../utils/chatbotPhone');
const { parseGupshupTemplateSendResponse } = require('../../utils/gupshupMessageIds');
const {
  buildTextMessageField,
  buildInteractiveButtonMessageField,
  buildInteractiveListMessageField,
} = require('../../utils/gupshupSessionPayload');
const { isWhatsAppEnabled } = require('../gupshupService');

const GUPSHUP_SESSION_URL = 'https://api.gupshup.io/wa/api/v1/msg';

function isIntegrationStub() {
  return String(process.env.WA_INTEGRATION_STUB || '').trim() === '1';
}

function sessionTimeoutMs() {
  return Math.min(
    Math.max(parseInt(process.env.GUPSHUP_CHATBOT_SEND_TIMEOUT_MS || '', 10) || 20000, 5000),
    120000
  );
}

/**
 * @param {string} phone10
 * @param {string} messageFieldJson - pre-built message JSON string
 * @param {{ correlationId?: string }} [opts]
 */
async function sendSessionMessageRaw(phone10, messageFieldJson, opts = {}) {
  if (isIntegrationStub()) {
    const crypto = require('crypto');
    const messageId = `test-chat-${crypto.randomUUID()}`;
    return {
      success: true,
      stub: true,
      data: { messageId, status: 'submitted', id: messageId },
    };
  }

  if (!isWhatsAppEnabled()) {
    return { success: false, error: 'WhatsApp disabled (ENABLE_WHATSAPP)' };
  }

  const apiKey = process.env.GUPSHUP_API_KEY;
  const source = process.env.GUPSHUP_SOURCE;
  if (!apiKey || !source) {
    return { success: false, error: 'Gupshup not configured' };
  }

  const destination = formatPhoneE16491(phone10);
  if (!destination) {
    return { success: false, error: 'invalid phone' };
  }

  const body = new URLSearchParams();
  body.append('source', String(source).replace(/\D/g, ''));
  body.append('destination', String(destination).replace(/\D/g, ''));
  body.append('channel', 'whatsapp');
  body.append('message', messageFieldJson);
  if (process.env.GUPSHUP_SRC_NAME) {
    body.append('src.name', process.env.GUPSHUP_SRC_NAME);
  }

  try {
    const res = await axios.post(GUPSHUP_SESSION_URL, body.toString(), {
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: sessionTimeoutMs(),
      validateStatus: () => true,
    });

    const data = res.data;
    const parsedIds = parseGupshupTemplateSendResponse(data);

    if (res.status >= 400) {
      const errMsg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
      if (parsedIds.canonicalMessageId) {
        return { success: true, data, ambiguousAccept: true };
      }
      return { success: false, error: String(errMsg), data, httpStatus: res.status };
    }

    if (data && (data.status === 'error' || data.success === false)) {
      const errMsg = data.message || data.error || 'Gupshup API error';
      if (parsedIds.canonicalMessageId) {
        return { success: true, data, ambiguousAccept: true };
      }
      return { success: false, error: String(errMsg), data, httpStatus: res.status };
    }

    return { success: true, data };
  } catch (e) {
    const responseData = e.response && e.response.data ? e.response.data : null;
    const parsedIds = parseGupshupTemplateSendResponse(responseData);
    const msg = responseData
      ? responseData.message || responseData.error || e.message
      : e.message;
    if (parsedIds.canonicalMessageId) {
      return { success: true, data: responseData, ambiguousAccept: true };
    }
    return { success: false, error: msg || 'Gupshup request failed', data: responseData };
  }
}

async function sendTextMessage(phone10, text, opts = {}) {
  const field = buildTextMessageField(text, opts.previewUrl);
  return sendSessionMessageRaw(phone10, field, opts);
}

async function sendButtonMessage(phone10, body, buttons, opts = {}) {
  const field = buildInteractiveButtonMessageField({ body, buttons });
  return sendSessionMessageRaw(phone10, field, opts);
}

async function sendListMessage(phone10, body, buttonText, sections, opts = {}) {
  const field = buildInteractiveListMessageField({ body, buttonText, sections });
  return sendSessionMessageRaw(phone10, field, opts);
}

module.exports = {
  GUPSHUP_SESSION_URL,
  sendSessionMessageRaw,
  sendTextMessage,
  sendButtonMessage,
  sendListMessage,
  buildTextMessageField,
  buildInteractiveButtonMessageField,
  buildInteractiveListMessageField,
};
