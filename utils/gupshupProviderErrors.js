'use strict';

const { extractMetaStatusErrors } = require('../controllers/gupshupWebhookController');

/**
 * @param {unknown} code
 * @returns {string|null}
 */
function normalizeCode(code) {
  if (code == null || code === '') return null;
  return String(code).trim().slice(0, 32) || null;
}

/**
 * Extract provider error code from Gupshup template send API JSON body.
 * @param {unknown} data
 * @param {number|null|undefined} httpStatus
 * @returns {string|null}
 */
function extractGupshupSendErrorCode(data, httpStatus) {
  if (data == null) {
    if (httpStatus != null && Number.isFinite(Number(httpStatus)) && Number(httpStatus) >= 400) {
      return `HTTP_${Number(httpStatus)}`;
    }
    return null;
  }

  let root = data;
  if (typeof data === 'string') {
    try {
      root = JSON.parse(data);
    } catch {
      return httpStatus != null && Number(httpStatus) >= 400 ? `HTTP_${Number(httpStatus)}` : null;
    }
  }

  if (!root || typeof root !== 'object') {
    return httpStatus != null && Number(httpStatus) >= 400 ? `HTTP_${Number(httpStatus)}` : null;
  }

  const candidates = [
    root.code,
    root.errorCode,
    root.error_code,
    root.statusCode,
    root.status_code
  ];
  for (const c of candidates) {
    const n = normalizeCode(c);
    if (n) return n;
  }

  if (Array.isArray(root.errors) && root.errors[0] && root.errors[0].code != null) {
    const n = normalizeCode(root.errors[0].code);
    if (n) return n;
  }

  if (root.payload && typeof root.payload === 'object' && !Array.isArray(root.payload)) {
    const inner = root.payload.payload && typeof root.payload.payload === 'object'
      ? root.payload.payload
      : root.payload;
    if (inner && inner.code != null) {
      const n = normalizeCode(inner.code);
      if (n) return n;
    }
  }

  if (httpStatus != null && Number.isFinite(Number(httpStatus)) && Number(httpStatus) >= 400) {
    return `HTTP_${Number(httpStatus)}`;
  }
  return null;
}

/**
 * Meta-style messages often embed code as "(#132012) …".
 * @param {string|null|undefined} errorMessage
 * @returns {string|null}
 */
function parseMetaCodeFromText(errorMessage) {
  const s = errorMessage == null ? '' : String(errorMessage);
  const m = s.match(/\(#(\d+)\)/);
  return m ? normalizeCode(m[1]) : null;
}

/**
 * @param {string|null|undefined} snippet
 * @returns {string|null}
 */
function extractCodeFromPayloadSnippet(snippet) {
  if (!snippet || typeof snippet !== 'string') return null;
  try {
    const parsed = JSON.parse(snippet.replace(/…$/, ''));
    return extractGupshupSendErrorCode(parsed, null);
  } catch {
    return null;
  }
}

/**
 * Best-effort parse of stored webhook raw snippet (Meta WABA or Gupshup message-event).
 * @param {string|null|undefined} rawPayloadSnippet
 * @returns {{ errorCode: string|null, errorReason: string|null }}
 */
function parseWebhookPayloadForErrors(rawPayloadSnippet) {
  if (!rawPayloadSnippet || typeof rawPayloadSnippet !== 'string') {
    return { errorCode: null, errorReason: null };
  }
  let body;
  try {
    body = JSON.parse(rawPayloadSnippet.replace(/…$/, ''));
  } catch {
    return { errorCode: null, errorReason: null };
  }

  const meta = extractMetaStatusErrors(body);
  if (meta.failureCode) {
    return { errorCode: meta.failureCode, errorReason: meta.failureReason };
  }

  let root = body;
  if (body && typeof body.payload === 'string') {
    try {
      root = JSON.parse(body.payload);
    } catch {
      root = body;
    }
  }
  if (root && String(root.type || '').toLowerCase() === 'message-event') {
    const p = root.payload;
    const inner = p && p.payload && typeof p.payload === 'object' && !Array.isArray(p.payload)
      ? p.payload
      : {};
    const code = inner.code != null ? normalizeCode(inner.code) : null;
    const reason = inner.reason != null ? String(inner.reason).slice(0, 2000) : null;
    if (code) return { errorCode: code, errorReason: reason };
  }

  return { errorCode: null, errorReason: null };
}

/**
 * Unified display fields for ops UI (Recovery, Audit, timeline).
 * @param {object} event
 * @returns {{ errorCode: string|null, errorReason: string|null, errorSource: 'dlr'|'send'|'parsed'|null }}
 */
function resolveProviderErrorDisplay(event) {
  const ev = event || {};
  const webhookCode = normalizeCode(ev.webhookErrorCode);
  const sendCode = normalizeCode(ev.sendErrorCode);
  const webhookReason = ev.webhookErrorReason ? String(ev.webhookErrorReason).slice(0, 2000) : null;
  const errorMessage = ev.errorMessage ? String(ev.errorMessage).slice(0, 2000) : null;

  if (webhookCode) {
    return {
      errorCode: webhookCode,
      errorReason: webhookReason || errorMessage,
      errorSource: 'dlr'
    };
  }

  if (sendCode) {
    return {
      errorCode: sendCode,
      errorReason: errorMessage,
      errorSource: 'send'
    };
  }

  const metaFromText = parseMetaCodeFromText(errorMessage);
  if (metaFromText) {
    return {
      errorCode: metaFromText,
      errorReason: errorMessage,
      errorSource: 'parsed'
    };
  }

  const fromSnippet = extractCodeFromPayloadSnippet(ev.providerPayloadSnippet);
  if (fromSnippet) {
    return {
      errorCode: fromSnippet,
      errorReason: errorMessage,
      errorSource: 'parsed'
    };
  }

  return {
    errorCode: null,
    errorReason: webhookReason || errorMessage,
    errorSource: null
  };
}

module.exports = {
  extractGupshupSendErrorCode,
  parseMetaCodeFromText,
  extractCodeFromPayloadSnippet,
  parseWebhookPayloadForErrors,
  resolveProviderErrorDisplay
};
