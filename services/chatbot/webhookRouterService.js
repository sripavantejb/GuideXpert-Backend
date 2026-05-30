const { parseInboundWebhook } = require('../../utils/gupshupInboundPayload');

/**
 * Detect Meta / Gupshup `request_welcome` webhook type.
 * Meta sends this when a user opens a chat for the first time with the Welcome Messages
 * feature enabled. Gupshup may surface it as the outer `type` or as `payload.type`.
 * We must NOT send a reply in response — the real chatbot reply comes via the normal
 * inbound message that immediately follows.
 */
function isRequestWelcome(body) {
  if (!body || typeof body !== 'object') return false;

  let root = body;
  if (typeof body.payload === 'string') {
    try { root = JSON.parse(body.payload); } catch { root = body; }
  }

  const outerType = String(root.type || '').toLowerCase();
  if (outerType === 'request_welcome') return true;

  const pType = root.payload && typeof root.payload === 'object'
    ? String(root.payload.type || '').toLowerCase()
    : '';
  if (pType === 'request_welcome') return true;

  if (Array.isArray(root.entry)) {
    for (const entry of root.entry) {
      for (const ch of (Array.isArray(entry.changes) ? entry.changes : [])) {
        const msgs = ch && ch.value && Array.isArray(ch.value.messages) ? ch.value.messages : [];
        for (const msg of msgs) {
          if (String(msg.type || '').toLowerCase() === 'request_welcome') return true;
        }
      }
    }
  }

  return false;
}

/**
 * Classify webhook body as inbound user message, request_welcome, or outbound DLR.
 * @param {object} body
 * @returns {{ kind: 'inbound'|'request_welcome'|'dlr', parsed: object|null }}
 */
function classifyWebhookBody(body) {
  if (isRequestWelcome(body)) {
    return { kind: 'request_welcome', parsed: null };
  }
  const inbound = parseInboundWebhook(body);
  if (inbound.isInbound && inbound.parsed) {
    return { kind: 'inbound', parsed: inbound.parsed };
  }
  return { kind: 'dlr', parsed: null };
}

module.exports = { classifyWebhookBody, isRequestWelcome };
