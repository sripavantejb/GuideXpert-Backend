/**
 * Gupshup outbound template response + message-event webhook use different id fields:
 * - Gupshup internal UUID (matches DLR `gsId`, enqueued/failed outer `payload.id`)
 * - WhatsApp / Meta message id (`wamid.*`, `gBEG*`, DLR `payload.id` when gsId is present)
 * @see https://docs.gupshup.io/docs/message-events
 */

function trimStr(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s || '';
}

/** Gupshup-style UUID (enqueued id, gsId on DLR) */
function isLikelyGupshupInternalId(s) {
  const t = trimStr(s);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t);
}

/** WhatsApp cloud API message id shapes seen on DLR when gsId is absent (MM Lite) */
function isLikelyWaMessageId(s) {
  const t = trimStr(s);
  if (!t) return false;
  if (t.startsWith('wamid.')) return true;
  if (t.startsWith('gBEG') || t.startsWith('ABEG')) return true;
  return false;
}

/**
 * Collect string id candidates from a shallow + one-level nested object (send API responses vary).
 * @param {unknown} data
 * @returns {string[]}
 */
function collectIdCandidatesFromObject(data) {
  if (!data || typeof data !== 'object') return [];
  const out = [];
  const keys = [
    'messageId',
    'message_id',
    'id',
    'msgId',
    'gsId',
    'gs_id',
    'GsSentMessageId',
    'requestId',
    'request_id'
  ];
  for (const k of keys) {
    const v = data[k];
    if (v != null && typeof v !== 'object') {
      const t = trimStr(v);
      if (t) out.push(t);
    }
  }
  for (const v of Object.values(data)) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of keys) {
        const inner = v[k];
        if (inner != null && typeof inner !== 'object') {
          const t = trimStr(inner);
          if (t) out.push(t);
        }
      }
    }
  }
  return [...new Set(out)];
}

/**
 * @param {unknown} data - result.data from Gupshup template send
 * @returns {{ gupshupInternalMessageId: string|null, whatsappWaMessageId: string|null, canonicalMessageId: string|null }}
 */
function parseGupshupTemplateSendResponse(data) {
  if (!data || typeof data !== 'object') {
    return { gupshupInternalMessageId: null, whatsappWaMessageId: null, canonicalMessageId: null };
  }
  const candidates = collectIdCandidatesFromObject(data);
  let internal = null;
  let wa = null;
  for (const c of candidates) {
    if (isLikelyGupshupInternalId(c)) internal = internal || c;
    else if (isLikelyWaMessageId(c)) wa = wa || c;
    else if (c.length >= 20 && !internal) internal = c; // fallback: long opaque id
  }
  // Prefer internal UUID for canonical (matches webhook gsId); else WA id for MM-only flows
  const canonicalMessageId = internal || wa || (candidates[0] || null);
  return {
    gupshupInternalMessageId: internal,
    whatsappWaMessageId: wa,
    canonicalMessageId
  };
}

/**
 * Build Mongo match clause for WhatsAppMessageEvent rows that may match webhook provider ids.
 * @param {string[]} providerIds
 */
function messageEventIdMatchClause(providerIds) {
  const ids = [...new Set((providerIds || []).map(trimStr).filter(Boolean))];
  if (!ids.length) return null;
  return {
    $or: [
      { gupshupMessageId: { $in: ids } },
      { gupshupInternalMessageId: { $in: ids } },
      { whatsappWaMessageId: { $in: ids } }
    ]
  };
}

module.exports = {
  trimStr,
  isLikelyGupshupInternalId,
  isLikelyWaMessageId,
  parseGupshupTemplateSendResponse,
  messageEventIdMatchClause,
  collectIdCandidatesFromObject
};
