/**
 * Classify Gupshup template send HTTP results for durable WhatsAppMessageEvent persistence.
 */
const { parseGupshupTemplateSendResponse } = require('./gupshupMessageIds');
const { dlrReconcileGraceMs } = require('./whatsappRetryRules');
const { isIitSlotBookedTemplateEnvKey } = require('./iitCounsellingWhatsApp');

function isAmbiguousGupshupSendError(errText) {
  const s = String(errText || '').toLowerCase();
  return /timeout|timed out|etimedout|econnaborted|econnreset|econnrefused|network|socket hang up|aborted|enotfound/.test(
    s
  );
}

function isIitSlotBookedSend(retryKind, outboundProduct, templateIdEnvKey) {
  return (
    outboundProduct === 'iit_counselling' ||
    (retryKind === 'slot_booked' && isIitSlotBookedTemplateEnvKey(templateIdEnvKey))
  );
}

/**
 * @param {{ success?: boolean, data?: unknown, error?: string, ambiguousAccept?: boolean }}|null|undefined result
 * @param {{ retryKind: string, outboundProduct: string, templateIdEnvKey?: string|null }} ctx
 */
function classifyGupshupSendOutcome(result, ctx) {
  const ids = parseGupshupTemplateSendResponse(result && result.data);
  const hasId = Boolean(ids.canonicalMessageId);
  const errText = result && result.error ? String(result.error) : '';
  const explicitSuccess = Boolean(result && result.success);
  const iitSlot = isIitSlotBookedSend(ctx.retryKind, ctx.outboundProduct, ctx.templateIdEnvKey);

  if (explicitSuccess || result?.ambiguousAccept || hasId) {
    return {
      treatAsAccepted: true,
      ids,
      messageId: ids.canonicalMessageId || null,
      useAwaitingReconcile: false,
      errText: null,
      reason: explicitSuccess ? 'provider_success' : hasId ? 'parsed_id_from_body' : 'ambiguous_accept_flag'
    };
  }

  if (iitSlot && isAmbiguousGupshupSendError(errText)) {
    return {
      treatAsAccepted: true,
      ids,
      messageId: ids.canonicalMessageId || null,
      useAwaitingReconcile: true,
      errText: errText || 'ambiguous_send_timeout',
      reason: 'iit_ambiguous_timeout'
    };
  }

  return {
    treatAsAccepted: false,
    ids,
    messageId: null,
    useAwaitingReconcile: false,
    errText: errText || 'send failed',
    reason: null
  };
}

/**
 * Reconcile grace fields when send outcome is ambiguous (DLR may still arrive).
 * @param {Date} now
 */
function buildAwaitingReconcileFields(now) {
  const graceMs = dlrReconcileGraceMs();
  return {
    status: 'awaiting_final_dlr',
    reconcilePendingAt: now,
    reconcileFinalityUntil: new Date(now.getTime() + graceMs),
    reconcileDerivedFailure: false,
    retryEligible: false,
    retryExclusionReason: null,
    retryExclusionAt: null,
    'retryExclusionMeta.note': 'send_ambiguous_awaiting_dlr'
  };
}

module.exports = {
  isAmbiguousGupshupSendError,
  isIitSlotBookedSend,
  classifyGupshupSendOutcome,
  buildAwaitingReconcileFields
};
