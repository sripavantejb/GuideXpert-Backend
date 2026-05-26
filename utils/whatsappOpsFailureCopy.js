'use strict';

const { resolveProviderErrorDisplay } = require('./gupshupProviderErrors');

/** Meta / WhatsApp Cloud API error codes → operator-facing headline. */
const META_ERROR_HEADLINES = {
  131008: 'Message could not be sent (parameter required)',
  131009: 'Message could not be sent (parameter invalid)',
  131026: 'Not on WhatsApp or number undeliverable',
  131031: 'Account locked by Meta',
  131042: 'Business payment or billing issue',
  131045: 'Incorrect business phone registration',
  131047: 'Re-engagement message required',
  131048: 'Spam rate limit hit',
  131049: 'Not delivered (WhatsApp engagement limit)',
  131051: 'Unsupported message type for this user',
  131052: 'Media download failed',
  131053: 'Media upload failed',
  132000: 'Template parameter count mismatch',
  132001: 'Template does not exist or not approved',
  132005: 'Template text too long after hydration',
  132007: 'Template format invalid',
  132012: 'Template parameter format mismatch',
  132015: 'Template paused or disabled',
  132016: 'Template permanently disabled',
  470: 'Invalid WhatsApp user (Gupshup)',
  1002: 'Number not on WhatsApp (Gupshup)',
};

const LIFECYCLE_HEADLINES = {
  transient_unresolved: 'Delivery failed (may be retried)',
  reconcile_pending: 'Waiting for final delivery status from WhatsApp',
  reconcile_derived_failed: 'Marked failed after delivery grace period',
  retry_exhausted: 'All retry attempts used',
  failed: 'Delivery failed',
  not_accepted: 'Never accepted by WhatsApp provider',
  in_flight_stale: 'Stuck in flight — no final status',
  unknown: 'Unresolved delivery issue',
};

const EXCLUSION_HEADLINES = {
  already_delivered_or_read: 'Already delivered or read — no resend',
  duplicate_prevented: 'Duplicate send prevented',
  retry_disabled: 'Retries disabled for this message',
  permanent_failure: 'Permanent failure — will not retry',
  invalid_whatsapp: 'Invalid WhatsApp number',
  cooldown_blocked: 'Retry blocked by cooldown',
  manual_recovery_blocked: 'Blocked from manual recovery',
  missing_phone: 'Missing phone number',
  missing_registration: 'No registered submission found',
  policy_non_retryable: 'Non-retryable by policy',
  in_flight_timeout: 'In-flight timeout',
  promotion_superseded: 'Superseded by a newer attempt',
  eligibility_timing_blocked: 'Outside reminder send window',
  dlr_failed_after_accept: 'Failed after provider accepted send',
  webhook_stale_unresolved: 'Webhook stale — status unresolved',
  other: 'Excluded from automated retry',
};

const HTTP_SEND_HEADLINES = {
  HTTP_400: 'Gupshup rejected the send (bad request)',
  HTTP_401: 'Gupshup rejected the send (unauthorized)',
  HTTP_403: 'Gupshup rejected the send (forbidden)',
  HTTP_404: 'Gupshup rejected the send (not found)',
  HTTP_429: 'Gupshup rate limit exceeded',
  HTTP_500: 'Gupshup server error during send',
  HTTP_502: 'Gupshup gateway error during send',
  HTTP_503: 'Gupshup temporarily unavailable',
};

function stripMetaCodePrefix(text) {
  if (!text) return '';
  return String(text).replace(/^\(#\d+\)\s*/, '').trim();
}

function headlineForProviderCode(code) {
  if (!code) return null;
  const c = String(code).trim();
  if (META_ERROR_HEADLINES[c]) return META_ERROR_HEADLINES[c];
  if (HTTP_SEND_HEADLINES[c]) return HTTP_SEND_HEADLINES[c];
  if (/^HTTP_\d+$/.test(c)) return HTTP_SEND_HEADLINES[c] || 'Gupshup rejected the send request';
  return null;
}

function headlineForLifecycle(slug) {
  if (!slug) return null;
  return LIFECYCLE_HEADLINES[String(slug)] || null;
}

function headlineForExclusion(raw) {
  if (!raw) return null;
  const key = String(raw).trim();
  return EXCLUSION_HEADLINES[key] || null;
}

function technicalSourceLabel(source) {
  if (source === 'dlr') return 'DLR';
  if (source === 'send') return 'Send API';
  if (source === 'parsed') return 'Parsed';
  return '';
}

/**
 * Operator-facing failure description for Recovery / Audit tables.
 * @param {object} row
 * @returns {{ headline: string, detail: string|null, category: string, technicalCode: string|null, technicalSource: string|null }}
 */
function describeOpsFailure(row) {
  const r = row || {};
  const provider = resolveProviderErrorDisplay({
    webhookErrorCode: r.webhookErrorCode ?? r.errorCode,
    sendErrorCode: r.sendErrorCode,
    webhookErrorReason: r.webhookErrorReason ?? r.errorReason,
    errorMessage: r.errorMessage,
    providerPayloadSnippet: r.providerPayloadSnippet,
  });

  const rawProviderText =
    stripMetaCodePrefix(provider.errorReason) ||
    stripMetaCodePrefix(r.errorReason) ||
    stripMetaCodePrefix(r.errorMessage) ||
    null;

  const exclusionHeadline = headlineForExclusion(r.exclusionReason);
  const lifecycleHeadline =
    headlineForLifecycle(r.reason) ||
    headlineForLifecycle(r.canonicalExclusionReason) ||
    headlineForLifecycle(r.canonicalBucket);
  const providerHeadline = headlineForProviderCode(provider.errorCode);

  let headline = providerHeadline || exclusionHeadline || lifecycleHeadline;
  let category = 'unknown';

  if (providerHeadline) category = 'provider';
  else if (exclusionHeadline) category = 'exclusion';
  else if (lifecycleHeadline) category = 'lifecycle';
  else if (provider.errorCode || rawProviderText) category = 'provider';
  else if (r.exclusionReason || r.reason) category = 'lifecycle';

  if (!headline) {
    if (rawProviderText) {
      headline = rawProviderText.length > 80 ? `${rawProviderText.slice(0, 77)}…` : rawProviderText;
    } else if (r.lifecycleState === 'failed' || r.lifecycleState === 'retry_exhausted') {
      headline = 'Message delivery failed';
    } else {
      headline = 'Delivery issue — see details';
    }
  }

  const detailParts = [];
  if (rawProviderText && rawProviderText !== headline) detailParts.push(rawProviderText);
  if (exclusionHeadline && r.exclusionReason && !providerHeadline) {
    detailParts.push(`System note: ${exclusionHeadline}.`);
  }
  if (lifecycleHeadline && r.reason && r.reason !== headline && !providerHeadline) {
    detailParts.push(`Status: ${lifecycleHeadline}.`);
  }

  const detail = detailParts.length ? detailParts.join(' ') : rawProviderText || null;

  return {
    headline,
    detail,
    category,
    technicalCode: provider.errorCode || null,
    technicalSource: provider.errorSource || null,
    technicalSourceLabel: technicalSourceLabel(provider.errorSource),
  };
}

module.exports = {
  describeOpsFailure,
  META_ERROR_HEADLINES,
  LIFECYCLE_HEADLINES,
  EXCLUSION_HEADLINES,
};
