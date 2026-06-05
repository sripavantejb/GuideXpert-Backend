/**
 * Parse Gupshup / Meta inbound user-message webhook payloads.
 */
const crypto = require('crypto');
const { normalizePhone10 } = require('./chatbotPhone');

function unwrapRoot(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.payload === 'string') {
    try {
      return JSON.parse(body.payload);
    } catch {
      return body;
    }
  }
  return body;
}

function extractTextFromMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type === 'text' && msg.text != null) {
    return typeof msg.text === 'string' ? msg.text : msg.text.body || null;
  }
  if (msg.text != null && typeof msg.text === 'string') return msg.text;
  if (msg.text && msg.text.body) return String(msg.text.body);
  return null;
}

/**
 * Gupshup user message: type === "message" with payload.payload message object.
 */
function tryParseGupshupUserMessage(body) {
  const root = unwrapRoot(body);
  if (!root || typeof root !== 'object') return null;
  const outerType = String(root.type || '').toLowerCase();
  if (outerType !== 'message') return null;

  const p = root.payload;
  if (!p || typeof p !== 'object') return null;

  const inner = p.payload && typeof p.payload === 'object' ? p.payload : p;
  const msg = inner.message || inner;
  const sender = p.source || inner.source || root.source;
  const digits = String(sender || '').replace(/\D/g, '');
  const phone10 = digits.length >= 10 ? digits.slice(-10) : null;

  const providerMessageId =
    (p.id && String(p.id).trim()) ||
    (inner.id && String(inner.id).trim()) ||
    (msg.id && String(msg.id).trim()) ||
    null;

  let messageType = 'unknown';
  let text = null;
  let interactivePayload = null;

  const rawType = String(msg.type || inner.type || '').toLowerCase();
  if (rawType === 'text' || msg.text) {
    messageType = 'text';
    text = extractTextFromMessage(msg);
  } else if (rawType === 'button_reply' || msg.button_reply) {
    messageType = 'button_reply';
    interactivePayload = msg.button_reply || msg;
    text =
      (msg.button_reply && msg.button_reply.title) ||
      (msg.button_reply && msg.button_reply.id) ||
      JSON.stringify(msg.button_reply || msg);
  } else if (rawType === 'list_reply' || msg.list_reply) {
    messageType = 'list_reply';
    interactivePayload = msg.list_reply || msg;
    text =
      (msg.list_reply && msg.list_reply.title) ||
      (msg.list_reply && msg.list_reply.id) ||
      JSON.stringify(msg.list_reply || msg);
  } else if (rawType === 'interactive') {
    messageType = 'interactive';
    interactivePayload = msg.interactive || msg;
    text = extractTextFromMessage(msg.interactive) || null;
  } else if (['image', 'document', 'audio', 'video'].includes(rawType)) {
    messageType = rawType;
    text = msg.caption || null;
  } else if (rawType === 'location' || msg.location) {
    messageType = 'location';
    interactivePayload = msg.location;
  }

  const ts =
    root.timestamp != null && !Number.isNaN(Number(root.timestamp))
      ? new Date(Number(root.timestamp) > 1e12 ? Number(root.timestamp) : Number(root.timestamp) * 1000)
      : new Date();

  return {
    phone10,
    providerMessageId,
    messageType,
    text,
    interactivePayload,
    mediaUrl: msg.url || msg.link || null,
    location: msg.location || null,
    receivedAt: ts,
    dedupeKey: providerMessageId || null,
  };
}

/**
 * Meta WABA inbound: entry[].changes[].value.messages[]
 */
function tryParseMetaInboundMessage(body) {
  const root = unwrapRoot(body);
  if (!root || !Array.isArray(root.entry)) return null;

  for (const entry of root.entry) {
    const changes = entry && entry.changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      const value = ch && ch.value;
      if (!value || !Array.isArray(value.messages) || value.messages.length === 0) continue;
      const msg = value.messages[0];
      const from = msg.from || value.metadata?.display_phone_number;
      const phone10 = normalizePhone10(from);
      const providerMessageId = msg.id ? String(msg.id).trim() : null;

      let messageType = 'unknown';
      let text = null;
      let interactivePayload = null;

      if (msg.type === 'text' && msg.text) {
        messageType = 'text';
        text = msg.text.body || null;
      } else if (msg.type === 'button' && msg.button) {
        messageType = 'button_reply';
        interactivePayload = msg.button;
        text = msg.button.text || msg.button.payload || null;
      } else if (msg.type === 'interactive' && msg.interactive) {
        const ir = msg.interactive;
        if (ir.type === 'button_reply' && ir.button_reply) {
          messageType = 'button_reply';
          interactivePayload = ir.button_reply;
          text = ir.button_reply.title || ir.button_reply.id;
        } else if (ir.type === 'list_reply' && ir.list_reply) {
          messageType = 'list_reply';
          interactivePayload = ir.list_reply;
          text = ir.list_reply.title || ir.list_reply.id;
        } else {
          messageType = 'interactive';
          interactivePayload = ir;
        }
      } else if (msg.type === 'image') {
        messageType = 'image';
        text = msg.image?.caption || null;
      } else if (msg.type === 'location') {
        messageType = 'location';
        interactivePayload = msg.location;
      } else {
        messageType = msg.type || 'unknown';
      }

      const ts = msg.timestamp
        ? new Date(Number(msg.timestamp) * 1000)
        : new Date();

      return {
        phone10,
        providerMessageId,
        messageType,
        text,
        interactivePayload,
        mediaUrl: null,
        location: msg.location || null,
        receivedAt: ts,
        dedupeKey: providerMessageId || null,
      };
    }
  }
  return null;
}

/**
 * @param {object} body
 * @returns {{ isInbound: boolean, parsed: object|null }}
 */
function parseInboundWebhook(body) {
  const gup = tryParseGupshupUserMessage(body);
  if (gup && gup.phone10) {
    return { isInbound: true, parsed: gup };
  }
  const meta = tryParseMetaInboundMessage(body);
  if (meta && meta.phone10) {
    return { isInbound: true, parsed: meta };
  }
  return { isInbound: false, parsed: null };
}

function inboundDedupeBucketSec() {
  const configured = Number(process.env.CHATBOT_INBOUND_DEDUPE_BUCKET_SEC);
  return Number.isFinite(configured) && configured > 0 ? configured : 45;
}

/**
 * Stable dedupe key for the same user utterance even when Gupshup and Meta
 * webhooks use different provider message IDs.
 */
function buildInboundDedupeKey(parsed, body) {
  void body;

  const phone10 = parsed?.phone10;
  const textNorm = String(parsed?.text || '').trim().toLowerCase();
  const receivedAt =
    parsed?.receivedAt instanceof Date && !Number.isNaN(parsed.receivedAt.getTime())
      ? parsed.receivedAt
      : new Date();
  const bucket = Math.floor(receivedAt.getTime() / (inboundDedupeBucketSec() * 1000));

  if (phone10 && textNorm) {
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ phone: phone10, text: textNorm, bucket }))
      .digest('hex')
      .slice(0, 32);
    return `in:content:${hash}`;
  }

  if (parsed?.dedupeKey) {
    return `in:provider:${parsed.dedupeKey}`;
  }

  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ phone: phone10, ts: receivedAt.toISOString() }))
    .digest('hex')
    .slice(0, 32);
  return `in:hash:${hash}`;
}

function sanitizeInboundSnippet(body, max = 2000) {
  if (body == null) return null;
  let s = typeof body === 'string' ? body : JSON.stringify(body);
  s = s.replace(/apikey["']?\s*[:=]\s*["'][^"']+/gi, 'apikey":"***');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

module.exports = {
  tryParseGupshupUserMessage,
  tryParseMetaInboundMessage,
  parseInboundWebhook,
  buildInboundDedupeKey,
  inboundDedupeBucketSec,
  sanitizeInboundSnippet,
};
