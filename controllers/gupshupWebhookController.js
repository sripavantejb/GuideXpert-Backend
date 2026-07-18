const crypto = require('crypto');
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
const {
  messageEventIdMatchClause,
  isLikelyGupshupInternalId,
  isLikelyWaMessageId
} = require('../utils/gupshupMessageIds');
const { mapStageToDbStatus, canApplyWebhookStatus, rankSuccessStatus } = require('../utils/gupshupWebhookMonotonic');
const {
  isRetryableFailure,
  isCampaignStrategy,
  classifyCampaignFailure,
  RETRY_EXCLUSION_REASON
} = require('../utils/whatsappRetryRules');
const {
  pickBestWebhookMatchCandidate,
  buildPhoneFallbackMatchQuery,
  inferOpsProductFromWebhookSnippet
} = require('../utils/gupshupWebhookMatcher');

function sanitizeSnippet(raw, maxLen = 3800) {
  if (raw == null) return null;
  let s = typeof raw === 'string' ? raw : JSON.stringify(raw);
  s = s.replace(/apikey["']?\s*[:=]\s*["'][^"']+/gi, 'apikey":"***');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

function normalizeDeliveryHint(raw) {
  const v = raw == null ? '' : String(raw).trim().toLowerCase();
  if (!v) return null;
  if (v === 'enqueued' || v === 'submitted') return 'submitted';
  if (v.includes('read')) return 'read';
  if (v.includes('delivered') || v.includes('delivery')) return 'delivered';
  if (v.includes('fail') || v.includes('error') || v.includes('undeliver')) return 'failed';
  if (v === 'sent' || v.includes('enqueue') || v.includes('queued')) return 'sent';
  return v;
}

function normalizeEventType(raw) {
  const v = raw == null ? '' : String(raw).trim().toLowerCase();
  if (!v) return null;
  if (['enqueued', 'sent', 'delivered', 'read', 'failed'].includes(v)) return v;
  return null;
}

/**
 * Meta WABA webhooks: failure details live under entry[].changes[].value.statuses[].errors[].
 * @param {object} body
 * @returns {{ failureCode: string|null, failureReason: string|null }}
 */
function extractMetaStatusErrors(body) {
  let failureCode = null;
  let failureReason = null;

  function visit(node) {
    if (!node || failureCode) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node.statuses)) {
      for (const st of node.statuses) {
        if (!st || !Array.isArray(st.errors) || st.errors.length === 0) continue;
        const err = st.errors[0];
        if (err.code != null) failureCode = String(err.code).slice(0, 32);
        const msg =
          err.message ||
          err.title ||
          (err.error_data && err.error_data.details ? String(err.error_data.details) : null);
        if (msg) failureReason = String(msg).slice(0, 2000);
        return;
      }
    }
    Object.values(node).forEach(visit);
  }

  let root = body;
  if (body && typeof body.payload === 'string') {
    try {
      root = JSON.parse(body.payload);
    } catch {
      root = body;
    }
  }
  visit(root);
  return { failureCode, failureReason };
}

/**
 * Gupshup V2 message-event: outer `type` === `message-event`, inner stage in `payload.type`.
 * @see https://docs.gupshup.io/docs/message-events
 */
function tryParseMessageEventBody(body) {
  let root = body;
  if (body && typeof body.payload === 'string') {
    try {
      root = JSON.parse(body.payload);
    } catch {
      return null;
    }
  }
  if (!root || typeof root !== 'object') return null;
  if (String(root.type || '').toLowerCase() !== 'message-event') return null;
  const p = root.payload;
  if (!p || typeof p !== 'object') return null;

  const stage = normalizeEventType(p.type);
  const gsId = p.gsId != null ? String(p.gsId).trim() : null;
  const outerId = p.id != null ? String(p.id).trim() : null;
  const dest = p.destination;
  const digits = String(dest || '').replace(/\D/g, '');
  const phone10 = digits.length >= 10 ? digits.slice(-10) : null;
  const inner = p.payload && typeof p.payload === 'object' && !Array.isArray(p.payload) ? p.payload : {};
  const metaTs = inner.ts != null && !Number.isNaN(Number(inner.ts)) ? Number(inner.ts) : null;
  const failureCode = inner.code != null ? String(inner.code).slice(0, 32) : null;
  const failureReason = inner.reason != null ? String(inner.reason).slice(0, 2000) : null;
  const whatsappMessageFromInner =
    inner.whatsappMessageId != null ? String(inner.whatsappMessageId).trim() : null;
  const gupshupTimestamp = root.timestamp != null ? String(root.timestamp) : null;

  const providerIds = [...new Set([gsId, outerId, whatsappMessageFromInner].filter(Boolean))];
  return {
    stage,
    gsId,
    outerId,
    phone10,
    metaTs,
    failureCode,
    failureReason,
    whatsappMessageFromInner,
    gupshupTimestamp,
    providerIds,
    deliveryHintForSubmission: stage ? normalizeDeliveryHint(stage) : null
  };
}

/**
 * Meta Cloud API DLR: entry[].changes[].value.statuses[] (recipient_id + message id).
 * @param {object} body
 */
function extractMetaWabaStatusFields(body) {
  let root = body;
  if (body && typeof body.payload === 'string') {
    try {
      root = JSON.parse(body.payload);
    } catch {
      root = body;
    }
  }
  if (!root || typeof root !== 'object' || !Array.isArray(root.entry)) return null;

  const providerIds = [];
  let phone10 = null;
  let stage = null;
  let failureCode = null;
  let failureReason = null;

  for (const entry of root.entry) {
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];
    for (const ch of changes) {
      const statuses = ch && ch.value && Array.isArray(ch.value.statuses) ? ch.value.statuses : [];
      for (const st of statuses) {
        if (!st || typeof st !== 'object') continue;
        if (st.gs_id) providerIds.push(String(st.gs_id).trim());
        if (st.gsId) providerIds.push(String(st.gsId).trim());
        if (st.meta_msg_id) providerIds.push(String(st.meta_msg_id).trim());
        if (st.id) providerIds.push(String(st.id).trim());
        const recipDigits = String(st.recipient_id || '').replace(/\D/g, '');
        if (recipDigits.length >= 10) phone10 = recipDigits.slice(-10);
        const stNorm = normalizeEventType(st.status) || mapStageToDbStatus(st.status);
        if (stNorm) stage = stNorm;
        if (Array.isArray(st.errors) && st.errors.length > 0) {
          const err = st.errors[0];
          if (err.code != null) failureCode = String(err.code).slice(0, 32);
          const msg =
            err.message ||
            err.title ||
            (err.error_data && err.error_data.details ? String(err.error_data.details) : null);
          if (msg) failureReason = String(msg).slice(0, 2000);
        }
      }
    }
  }

  if (!providerIds.length && !phone10 && !stage) return null;
  return {
    providerIds: [...new Set(providerIds.filter(Boolean))],
    phone10,
    stage,
    failureCode,
    failureReason
  };
}

/**
 * Extract message id, recipient phone (10-digit IN), inbound status text from heterogeneous Gupshup payloads.
 */
function extractWebhookFields(body) {
  let root = body;
  let parseError = null;
  if (body && typeof body.payload === 'string') {
    try {
      root = JSON.parse(body.payload);
    } catch {
      root = body;
      parseError = 'payload_json_parse_failed';
    }
  }

  const metaHints = extractMetaWabaStatusFields(body);

  const gsIdCandidates = [];
  const payloadIdCandidates = [];
  const phoneCandidates = [];
  const statusCandidates = [];
  const eventTypeCandidates = [];

  function scoreProviderIdKey(key) {
    const k = String(key || '').toLowerCase();
    if (k === 'gsid' || k === 'gssentmessageid' || k === 'gs_id') return 6;
    if (k === 'messageid' || k === 'message_id') return 5;
    if (k === 'id') return 4;
    if (k.includes('message') && k.includes('id')) return 4;
    if (k.includes('gsid') || k.includes('gssentmessageid') || k.includes('gs_id')) return 6;
    return 1;
  }

  function scorePhoneKey(key) {
    const k = String(key || '').toLowerCase();
    if (k === 'phone' || k === 'mobile' || k === 'source' || k === 'recipient') return 5;
    if (k.includes('phone') || k.includes('mobile') || k.includes('source') || k.includes('recipient') || k.includes('destination')) return 4;
    return 1;
  }

  function scoreStatusKey(key) {
    const k = String(key || '').toLowerCase();
    if (k === 'type' || k === 'eventtype') return 6;
    if (k === 'status') return 5;
    if (k.includes('status') || k.includes('event') || k === 'type') return 4;
    return 1;
  }

  function pushGsId(value, score) {
    if (value == null) return;
    if (typeof value === 'object') return;
    const normalized = String(value).trim();
    if (!normalized) return;
    gsIdCandidates.push({ value: normalized, score });
  }

  function pushPayloadId(value, score) {
    if (value == null) return;
    if (typeof value === 'object') return;
    const normalized = String(value).trim();
    if (!normalized) return;
    payloadIdCandidates.push({ value: normalized, score });
  }

  function pushPhone(value, score) {
    if (value == null) return;
    if (typeof value === 'object') return;
    const digits = String(value).replace(/\D/g, '');
    if (digits.length < 10) return;
    phoneCandidates.push({ value: digits.slice(-10), score });
  }

  function pushStatus(value, score) {
    if (value != null && typeof value === 'object') return;
    const normalized = normalizeDeliveryHint(value);
    if (!normalized) return;
    statusCandidates.push({ value: normalized, score });
  }

  function pushEventType(value, score) {
    if (value != null && typeof value === 'object') return;
    const normalized = normalizeEventType(value);
    if (!normalized) return;
    eventTypeCandidates.push({ value: normalized, score });
  }

  function visit(node, depth) {
    if (depth > 12 || node == null) return;
    if (typeof node === 'string') {
      try {
        const j = JSON.parse(node);
        visit(j, depth + 1);
      } catch {
        /* ignore */
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((x) => visit(x, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;

    const gsId = node.gsId || node.GsSentMessageId || node.gs_id;
    pushGsId(gsId, 6);

    const payloadId =
      node.messageId ||
      node.message_id ||
      node.id ||
      (node.message && node.message.id);
    pushPayloadId(payloadId, 5);

    const phone =
      node.source ||
      node.mobile ||
      node.phone ||
      node.recipient ||
      node.destination ||
      node.waNumber;
    pushPhone(phone, 5);

    const typeLike =
      node.type ||
      node.eventType ||
      node.event ||
      (node.payload && node.payload.type) ||
      (node.messageStatus && node.messageStatus.type);
    pushEventType(typeLike, 6);

    const status =
      node.status ||
      node.eventType ||
      node.type ||
      node.event ||
      (node.message && node.message.status) ||
      (node.payload && node.payload.status) ||
      (node.messageStatus && node.messageStatus.status);
    pushStatus(status, 5);

    for (const [k, v] of Object.entries(node)) {
      if (v == null) continue;
      const idScore = scoreProviderIdKey(k);
      const phoneScore = scorePhoneKey(k);
      const statusScore = scoreStatusKey(k);
      const key = String(k || '').toLowerCase();
      if (idScore > 1 && (key.includes('gsid') || key.includes('gssentmessageid') || key.includes('gs_id'))) {
        pushGsId(v, idScore);
      } else if (idScore > 1) {
        pushPayloadId(v, idScore);
      }
      if (phoneScore > 1) pushPhone(v, phoneScore);
      if (statusScore > 1) {
        pushStatus(v, statusScore);
        pushEventType(v, statusScore);
      }
    }

    Object.values(node).forEach((x) => visit(x, depth + 1));
  }

  visit(root, 0);

  if (metaHints) {
    for (const id of metaHints.providerIds) {
      if (isLikelyGupshupInternalId(id)) pushGsId(id, 12);
      else if (isLikelyWaMessageId(id)) pushPayloadId(id, 12);
      else pushPayloadId(id, 12);
    }
    if (metaHints.phone10) pushPhone(metaHints.phone10, 12);
    if (metaHints.stage) {
      pushEventType(metaHints.stage, 12);
      pushStatus(metaHints.stage, 12);
    }
  }

  const best = (arr) => (arr.length ? arr.sort((a, b) => b.score - a.score)[0].value : null);
  const gsId = best(gsIdCandidates);
  const payloadId = best(payloadIdCandidates);
  const phone10 = metaHints && metaHints.phone10 ? metaHints.phone10 : best(phoneCandidates);
  const status = best(statusCandidates);
  const eventType =
    metaHints && metaHints.stage ? metaHints.stage : best(eventTypeCandidates);
  const providerIds = [
    ...new Set(
      [
        ...(metaHints && metaHints.providerIds ? metaHints.providerIds : []),
        ...gsIdCandidates.map((c) => c.value),
        ...payloadIdCandidates.map((c) => c.value),
        gsId,
        payloadId
      ].filter(Boolean)
    )
  ];
  const deliveryHint = eventType ? normalizeDeliveryHint(eventType) : (normalizeDeliveryHint(status) || null);
  const metaErrors = extractMetaStatusErrors(body);
  return {
    gsId,
    payloadId,
    providerIds,
    phone10,
    statusRaw: status || eventType || null,
    eventType: eventType || null,
    deliveryHint,
    status,
    parseError,
    failureCode: metaHints && metaHints.failureCode ? metaHints.failureCode : metaErrors.failureCode,
    failureReason:
      metaHints && metaHints.failureReason ? metaHints.failureReason : metaErrors.failureReason
  };
}

function buildDedupeKey(explicit, extracted, receivedAt) {
  const stage = explicit?.stage || extracted?.eventType || '';
  const gsId = explicit?.gsId || extracted?.gsId || '';
  const outerId = explicit?.outerId || extracted?.payloadId || '';
  const phone = explicit?.phone10 || extracted?.phone10 || '';
  const metaTs = explicit?.metaTs != null ? String(explicit.metaTs) : '';
  const gts = explicit?.gupshupTimestamp || '';
  const base = [stage, gsId, outerId, phone, metaTs, gts].join('|');
  if (!base.replace(/\|/g, '')) {
    const fallback = sanitizeSnippet({ e: extracted?.parseError, t: receivedAt.getTime() }, 500) || String(receivedAt.getTime());
    return crypto.createHash('sha256').update(fallback, 'utf8').digest('hex').slice(0, 64);
  }
  return crypto.createHash('sha256').update(base, 'utf8').digest('hex').slice(0, 64);
}

function transitionTimestamp(explicit, receivedAt) {
  if (explicit && explicit.metaTs != null && explicit.metaTs > 0) {
    return new Date(explicit.metaTs * 1000);
  }
  return receivedAt;
}

function submissionHintRank(hint) {
  const s = hint == null ? '' : String(hint).toLowerCase();
  if (s.includes('read')) return 40;
  if (s.includes('deliver')) return 30;
  if (s.includes('sent') && !s.includes('submit')) return 20;
  if (s.includes('submit') || s.includes('enqueued') || s === 'submitted') return 10;
  if (s.includes('fail')) return 25;
  return 0;
}

/** When outer `type` is not message-event, infer DB status from recursive parse hints. */
function inferredStatusFromDeliveryHint(hint) {
  if (!hint || hint === 'unknown') return null;
  const h = String(hint).toLowerCase();
  if (h === 'read') return 'read';
  if (h === 'delivered') return 'delivered';
  if (h === 'failed') return 'failed';
  if (h === 'sent') return 'sent';
  if (h === 'submitted') return 'submitted';
  return null;
}

function mergeExplicitAndExtracted(explicit, extracted) {
  const providerIds = [
    ...new Set([
      ...(explicit?.providerIds || []),
      ...(extracted?.providerIds || [])
    ].filter(Boolean))
  ];
  const phone10 = explicit?.phone10 || extracted?.phone10 || null;
  const gsId = explicit?.gsId || extracted?.gsId || null;
  const payloadId = explicit?.outerId || extracted?.payloadId || null;
  const stage = explicit?.stage || extracted?.eventType || null;
  const dbStatusFromStage = stage ? mapStageToDbStatus(stage) : null;
  const deliveryHint =
    explicit?.deliveryHintForSubmission ||
    extracted?.deliveryHint ||
    (stage ? normalizeDeliveryHint(stage) : null) ||
    'unknown';
  const statusRaw = stage || extracted?.statusRaw || null;
  const parseError = extracted?.parseError || null;
  const failureCode = explicit?.failureCode || extracted?.failureCode || null;
  const failureReason = explicit?.failureReason || extracted?.failureReason || null;
  const whatsappMessageFromInner = explicit?.whatsappMessageFromInner || null;
  return {
    providerIds,
    phone10,
    gsId,
    payloadId,
    stage,
    dbStatusFromStage,
    deliveryHint,
    statusRaw,
    parseError,
    failureCode,
    failureReason,
    whatsappMessageFromInner
  };
}

function buildIdPatchFromWebhook(doc, { gsId, outerId, whatsappMessageFromInner }) {
  const set = {};
  if (gsId && !doc.gupshupInternalMessageId && isLikelyGupshupInternalId(gsId)) {
    set.gupshupInternalMessageId = gsId;
  }
  if (outerId) {
    if (isLikelyWaMessageId(outerId) && !doc.whatsappWaMessageId) set.whatsappWaMessageId = outerId;
    else if (isLikelyGupshupInternalId(outerId) && !doc.gupshupInternalMessageId) {
      set.gupshupInternalMessageId = outerId;
    }
  }
  if (whatsappMessageFromInner && !doc.whatsappWaMessageId) {
    set.whatsappWaMessageId = whatsappMessageFromInner;
  }
  if (gsId && isLikelyGupshupInternalId(gsId) && !doc.gupshupMessageId) {
    set.gupshupMessageId = gsId;
  } else if (outerId && isLikelyGupshupInternalId(outerId) && !doc.gupshupMessageId) {
    set.gupshupMessageId = outerId;
  }
  return set;
}

/**
 * Apply monotonic status + first transition timestamps + id backfill from webhook.
 * Enqueued events may only add provider ids while status stays `submitted`.
 */
async function applyWebhookToMessageEvent(doc, newStatus, opts) {
  const {
    receivedAt,
    transitionTs,
    failureCode,
    failureReason,
    gsId,
    outerId,
    whatsappMessageFromInner,
    stage
  } = opts;

  const idPatch = buildIdPatchFromWebhook(doc, { gsId, outerId, whatsappMessageFromInner });
  const statusMayChange =
    newStatus &&
    canApplyWebhookStatus(doc.status, newStatus, {
      reconcileDerivedFailure: doc.reconcileDerivedFailure === true,
      terminalFailureKind: doc.terminalFailureKind,
      retryExclusionReason: doc.retryExclusionReason,
      allowTerminalRecovery: opts.allowTerminalRecovery === true
    });
  const enqueuedIdOnly =
    String(stage || '').toLowerCase() === 'enqueued' &&
    newStatus === 'submitted' &&
    String(doc.status || '').toLowerCase() === 'submitted' &&
    Object.keys(idPatch).length > 0;

  if (!statusMayChange && !enqueuedIdOnly) {
    return { modified: false, reason: 'monotonic_block' };
  }

  const set = {
    ...idPatch,
    updatedAt: receivedAt
  };

  if (statusMayChange) {
    set.status = newStatus;
    if (newStatus === 'sent' && !doc.sentAt) set.sentAt = transitionTs;
    if (newStatus === 'delivered' && !doc.deliveredAt) set.deliveredAt = transitionTs;
    if (newStatus === 'read' && !doc.readAt) set.readAt = transitionTs;
    if (newStatus === 'failed') {
      set.failedAt = transitionTs;
      const failCtx = {
        errorCode: failureCode,
        errorReason: failureReason,
        errorText: failureReason || doc.errorMessage
      };
      const wasProviderAccepted = rankSuccessStatus(doc.status) >= 3;
      if (isCampaignStrategy(doc.messageKind) && wasProviderAccepted) {
        const classified = classifyCampaignFailure(doc.messageKind, failCtx, {
          afterProviderAccept: true,
          attemptNumber: doc.attemptNumber
        });
        set.retryEligible = classified.retryable;
        set.terminalFailureKind = classified.terminalFailureKind;
        set.retryExclusionReason = classified.exclusionReason;
        set.retryExclusionAt = classified.exclusionReason ? receivedAt : null;
        set['retryExclusionMeta.nextAttempt'] = null;
        set['retryExclusionMeta.attemptBatchId'] = null;
        set['retryExclusionMeta.note'] = classified.metaNote;
        console.log(
          JSON.stringify({
            event: 'whatsapp_dlr_failed_after_accept',
            messageEventId: String(doc._id),
            messageKind: doc.messageKind,
            attemptNumber: doc.attemptNumber,
            retryable: classified.retryable,
            terminalFailureKind: classified.terminalFailureKind,
            exclusionReason: classified.exclusionReason
          })
        );
      } else if (isCampaignStrategy(doc.messageKind)) {
        const retryable = isRetryableFailure(doc.messageKind, failCtx);
        set.retryEligible = retryable;
        set.terminalFailureKind = retryable ? 'transient' : 'permanent';
        if (!retryable) {
          set.retryExclusionReason = RETRY_EXCLUSION_REASON.permanentFailure;
          set.retryExclusionAt = receivedAt;
        } else {
          set.retryExclusionReason = null;
          set.retryExclusionAt = null;
          set['retryExclusionMeta.nextAttempt'] = null;
          set['retryExclusionMeta.attemptBatchId'] = null;
          set['retryExclusionMeta.note'] = null;
        }
      } else {
        set.retryEligible = (
          Number(doc.attemptNumber || 1) === 1 &&
          isRetryableFailure(doc.messageKind, failCtx)
        );
        set.retryExclusionReason = null;
        set.retryExclusionAt = null;
        set['retryExclusionMeta.nextAttempt'] = null;
        set['retryExclusionMeta.attemptBatchId'] = null;
        set['retryExclusionMeta.note'] = null;
      }
      if (failureCode) set.webhookErrorCode = failureCode;
      if (failureReason) {
        set.webhookErrorReason = failureReason;
        set.errorMessage = failureReason;
      }
      console.log(
        JSON.stringify({
          event: 'whatsapp_webhook_failed',
          messageEventId: String(doc._id),
          messageKind: doc.messageKind,
          attemptNumber: doc.attemptNumber,
          failureCode: failureCode || null,
          failureReason: failureReason || null
        })
      );
    }
    if (newStatus === 'delivered' || newStatus === 'read') {
      const cur = String(doc.status || '').toLowerCase();
      const lateRecovery =
        cur === 'awaiting_final_dlr' ||
        doc.reconcileDerivedFailure === true ||
        (cur === 'failed' && doc.terminalFailureKind !== 'permanent');
      set.retryEligible = false;
      set.retryExclusionReason = RETRY_EXCLUSION_REASON.alreadyDeliveredOrRead;
      set.retryExclusionAt = receivedAt;
      set.reconcileDerivedFailure = false;
      set.reconcilePendingAt = null;
      set.reconcileFinalityUntil = null;
      set['retryExclusionMeta.note'] = lateRecovery ? 'late_dlr_recovery' : 'webhook_recovery';
      if (lateRecovery) {
        console.log(
          JSON.stringify({
            event: 'whatsapp_late_dlr_recovery',
            messageEventId: String(doc._id),
            messageKind: doc.messageKind,
            attemptNumber: doc.attemptNumber,
            fromStatus: cur,
            toStatus: newStatus
          })
        );
      }
    }
    if (newStatus === 'failed') {
      set.reconcileDerivedFailure = false;
      set.reconcilePendingAt = null;
      set.reconcileFinalityUntil = null;
    }
  }

  const res = await WhatsAppMessageEvent.updateOne(
    { _id: doc._id },
    { $set: set }
  );
  if (doc.retryGroupId && (res.modifiedCount || 0) > 0) {
    try {
      const { syncReminderJobFromRetryGroup } = require('../services/whatsappReminderJobSync');
      await syncReminderJobFromRetryGroup(doc.retryGroupId);
    } catch {
      /* non-fatal P3 projection */
    }
  }
  return { modified: (res.modifiedCount || 0) > 0, reason: 'updated' };
}

exports.applyWebhookToMessageEvent = applyWebhookToMessageEvent;
exports.extractMetaStatusErrors = extractMetaStatusErrors;
exports.extractWebhookFields = extractWebhookFields;
exports.tryParseMessageEventBody = tryParseMessageEventBody;
exports.mergeExplicitAndExtracted = mergeExplicitAndExtracted;
exports.inferredStatusFromDeliveryHint = inferredStatusFromDeliveryHint;

/**
 * Apply DLR payload to WhatsAppMessageEvent rows (repair / replay; no HTTP).
 * @param {object} body parsed Gupshup webhook JSON
 * @param {Date} [receivedAt]
 * @returns {Promise<{ updatedEventCount: number, updatePath: string, resolvedMatchId: string|null }>}
 */
async function replayGupshupWebhookBody(body, receivedAt = new Date()) {
  const explicit = tryParseMessageEventBody(body);
  const extracted = extractWebhookFields(body);
  const merged = mergeExplicitAndExtracted(explicit, extracted);
  const {
    providerIds,
    phone10,
    gsId,
    payloadId,
    stage,
    dbStatusFromStage,
    deliveryHint,
    failureCode,
    failureReason,
    whatsappMessageFromInner
  } = merged;

  const transitionTs = transitionTimestamp(explicit, receivedAt);
  const newStatus = dbStatusFromStage || inferredStatusFromDeliveryHint(deliveryHint);
  let updatePath = 'none';
  let updatedEventCount = 0;
  let resolvedMatchId = null;

  const applyToDoc = async (d) => {
    if (!newStatus || !d) return false;
    const r = await applyWebhookToMessageEvent(d, newStatus, {
      receivedAt,
      transitionTs,
      failureCode,
      failureReason,
      gsId,
      outerId: payloadId,
      whatsappMessageFromInner,
      stage
    });
    if (r.modified) {
      resolvedMatchId = String(d._id);
      return true;
    }
    return false;
  };

  const tryUpdateDocs = async (query, matchLabel) => {
    const docs = await WhatsAppMessageEvent.find(query).limit(25).lean();
    const picked = pickBestWebhookMatchCandidate(docs);
    if (!picked) return 0;
    if (docs.length > 1) {
      console.log(
        JSON.stringify({
          event: 'provider_id_multi_match_resolved',
          matchLabel: matchLabel || 'provider_id',
          pickedEventId: String(picked._id),
          candidateCount: docs.length,
          replay: true
        })
      );
    }
    const ok = await applyToDoc(picked);
    return ok ? 1 : 0;
  };

  if (newStatus && providerIds.length > 0) {
    const idClause = messageEventIdMatchClause(providerIds);
    if (idClause) {
      const n = await tryUpdateDocs(idClause, 'provider_id');
      updatedEventCount = n;
      if (n > 0) updatePath = 'providerIds';
    }
    try {
      const {
        applyDeliveryStatusToAttempt,
      } = require('../services/conversationRecovery/conversationRecoveryDeliveryService');
      for (const pid of providerIds) {
        const updatedAttempt = await applyDeliveryStatusToAttempt({
          gupshupMessageId: pid,
          status: newStatus,
          at: transitionTs,
        });
        if (updatedAttempt) {
          if (updatePath === 'none') updatePath = 'conversation_recovery';
          break;
        }
      }
    } catch (_) {
      // never block replay on recovery DLR
    }
  }

  if (newStatus && updatedEventCount === 0 && phone10) {
    const inferredOps = inferOpsProductFromWebhookSnippet(JSON.stringify(body || {}));
    const phoneQuery = buildPhoneFallbackMatchQuery(phone10, receivedAt, {
      opsProduct: inferredOps || null
    });
    const nPhone = await tryUpdateDocs(phoneQuery, 'phone_fallback');
    if (nPhone > 0) {
      updatedEventCount = nPhone;
      updatePath = 'phone_fallback';
    }
  }

  return { updatedEventCount, updatePath, resolvedMatchId };
}

exports.replayGupshupWebhookBody = replayGupshupWebhookBody;

exports.ingestGupshupWebhook = async (req, res) => {
  const receivedAt =
    req && req._testReceivedAt instanceof Date ? req._testReceivedAt : new Date();
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const { verifyGupshupWebhookRequest } = require('../utils/gupshupWebhookAuth');
    const webhookAuth = verifyGupshupWebhookRequest(req);
    if (!webhookAuth.ok) {
      console.warn(
        JSON.stringify({
          event: 'webhook_auth_failed',
          statusCode: webhookAuth.statusCode || 401,
          error: webhookAuth.error || 'unauthorized',
        })
      );
      return res.status(webhookAuth.statusCode || 401).json({
        success: false,
        received: false,
        error: webhookAuth.error || 'unauthorized',
      });
    }

    if (String(process.env.CHATBOT_ENABLED || '1').trim() !== '0') {
      const { classifyWebhookBody } = require('../services/chatbot/webhookRouterService');
      const { handleInboundWebhook } = require('../services/chatbot/whatsappInboundService');
      const classified = classifyWebhookBody(body);

      if (classified.kind === 'request_welcome') {
        console.log(
          JSON.stringify({
            event: 'request_welcome_skipped',
            note: 'Meta/Gupshup request_welcome webhook received and ignored — chatbot will reply to the real inbound that follows',
          })
        );
        return res.status(200).json({ success: true, received: true, requestWelcome: true });
      }

      if (classified.kind === 'inbound') {
        // Always await inbound processing before responding. Deferred background
        // handling on Vercel returned 200 without persisting or sending replies.
        const inboundResult = await handleInboundWebhook(req, body, receivedAt).catch((err) => {
          console.error('[chatbot] inbound processing failed', err.message);
          throw err;
        });
        if (inboundResult.statusCode) {
          return res.status(inboundResult.statusCode).json({
            success: false,
            received: false,
            inbound: true,
            ...inboundResult,
          });
        }
        return res.status(200).json({
          success: true,
          received: true,
          inbound: true,
          ...inboundResult,
        });
      }
    }

    const explicit = tryParseMessageEventBody(body);
    const extracted = extractWebhookFields(body);
    const merged = mergeExplicitAndExtracted(explicit, extracted);
    const {
      providerIds,
      phone10,
      gsId,
      payloadId,
      stage,
      dbStatusFromStage,
      deliveryHint,
      statusRaw,
      parseError,
      failureCode,
      failureReason,
      whatsappMessageFromInner
    } = merged;

    const dedupeKey = buildDedupeKey(explicit, extracted, receivedAt);
    const rawPayloadSnippet = sanitizeSnippet(body);
    const logBody = String(process.env.LOG_GUPSHUP_WEBHOOK_BODY || '').toLowerCase() === 'true';

    let formSubmissionId = null;
    let matchedBy = null;
    let matchConfidence = null;
    let matchedProviderId = null;

    if (providerIds.length > 0) {
      const sub = await FormSubmission.findOne({
        whatsappLastMessageId: { $in: providerIds }
      })
        .select('_id whatsappLastMessageId')
        .lean();
      if (sub) {
        formSubmissionId = sub._id;
        matchedProviderId = sub.whatsappLastMessageId ? String(sub.whatsappLastMessageId) : null;
        matchedBy = 'providerId';
        matchConfidence = 'high';
      }
    }
    if (!formSubmissionId && phone10) {
      const sub2 = await FormSubmission.findOne({ phone: phone10 }).select('_id').lean();
      if (sub2) {
        formSubmissionId = sub2._id;
        matchedBy = 'phone';
        matchConfidence = 'medium';
      }
    }

    let webhookEventDoc = null;
    let chatbotDlrUpdated = false;
    try {
      webhookEventDoc = await WhatsAppWebhookEvent.create({
        eventKind: 'dlr',
        webhookDedupeKey: dedupeKey,
        receivedAt,
        messageId: matchedProviderId || gsId || payloadId || null,
        phone: phone10 || null,
        status: statusRaw || null,
        formSubmissionId: formSubmissionId || null,
        rawPayloadSnippet,
        matchedBy: matchedBy || (explicit ? 'message_event' : 'recursive'),
        matchConfidence: matchConfidence || (stage ? 'high' : 'low'),
        parseError: parseError || null
      });
    } catch (e) {
      if (e && (e.code === 11000 || String(e.message || '').includes('E11000'))) {
        console.log('[Gupshup webhook] dedupe_skip', { dedupeKey: dedupeKey ? `${dedupeKey.slice(0, 12)}…` : null });
        return res.status(200).json({ success: true, received: true, dedupe: true });
      }
      throw e;
    }

    const transitionTs = transitionTimestamp(explicit, receivedAt);
    const newStatus = dbStatusFromStage || inferredStatusFromDeliveryHint(deliveryHint);
    let updatePath = 'none';
    let updatedEventCount = 0;
    let resolvedMatchId = null;

    let quarantineCandidateEventIds = [];
    const applyToDoc = async (d) => {
      if (!newStatus || !d) return false;
      const r = await applyWebhookToMessageEvent(d, newStatus, {
        receivedAt,
        transitionTs,
        failureCode,
        failureReason,
        gsId,
        outerId: payloadId,
        whatsappMessageFromInner,
        stage
      });
      if (r.modified) {
        resolvedMatchId = String(d._id);
        return true;
      }
      return false;
    };

    const tryUpdateDocs = async (query, matchLabel) => {
      const docs = await WhatsAppMessageEvent.find(query).limit(25).lean();
      quarantineCandidateEventIds = docs.map((d) => d._id).slice(0, 25);
      if (docs.length > 1) {
        console.warn('[Gupshup webhook] provider_id_multi_match', {
          count: docs.length,
          matchLabel: matchLabel || 'provider_id',
          eventIds: docs.map((d) => String(d._id)).slice(0, 12),
          attemptNumbers: docs.map((d) => d.attemptNumber).filter((x) => x != null)
        });
      }
      const picked = pickBestWebhookMatchCandidate(docs);
      if (!picked) return 0;
      if (docs.length > 1) {
        console.log(
          JSON.stringify({
            event: 'provider_id_multi_match_resolved',
            matchLabel: matchLabel || 'provider_id',
            pickedEventId: String(picked._id),
            candidateCount: docs.length
          })
        );
      }
      const ok = await applyToDoc(picked);
      return ok ? 1 : 0;
    };

    if (newStatus && providerIds.length > 0) {
      const idClause = messageEventIdMatchClause(providerIds);
      if (idClause) {
        const n = await tryUpdateDocs(idClause, 'provider_id');
        updatedEventCount = n;
        if (n > 0) {
          updatePath = 'providerIds';
        }
      }
      if (updatedEventCount === 0 && String(process.env.CHATBOT_ENABLED || '1').trim() !== '0') {
        const { applyDlrToOutboundMessage } = require('../services/chatbot/chatbotDlrService');
        const chatbotDlr = await applyDlrToOutboundMessage({
          providerIds,
          newStatus: stage || newStatus,
          receivedAt,
          failureCode,
          failureReason,
          transitionTs,
        });
        if (chatbotDlr.updated) {
          chatbotDlrUpdated = true;
          updatePath = 'chatbot_outbound';
          updatedEventCount = 1;
        }
      }
      // Platform Feature #1 — Conversation Recovery attempts (gsId match; additive)
      try {
        const {
          applyDeliveryStatusToAttempt,
        } = require('../services/conversationRecovery/conversationRecoveryDeliveryService');
        for (const pid of providerIds) {
          const updatedAttempt = await applyDeliveryStatusToAttempt({
            gupshupMessageId: pid,
            status: newStatus,
            at: transitionTs,
          });
          if (updatedAttempt) {
            if (updatePath === 'none') updatePath = 'conversation_recovery';
            break;
          }
        }
      } catch (_) {
        // never block webhook on recovery DLR
      }
    }

    if (newStatus && updatedEventCount === 0 && phone10) {
      const inferredOps = inferOpsProductFromWebhookSnippet(rawPayloadSnippet);
      const phoneQuery = buildPhoneFallbackMatchQuery(phone10, receivedAt, {
        opsProduct: inferredOps || null
      });
      const nPhone = await tryUpdateDocs(phoneQuery, 'phone_fallback');
      if (nPhone > 0) {
        updatedEventCount = nPhone;
        updatePath = 'phone_fallback';
      }
    }

    if (newStatus && updatedEventCount === 0 && providerIds.length > 0) {
      console.warn('[Gupshup webhook] no_message_event_matched', {
        providerIds: providerIds.slice(0, 5),
        stage: stage || null,
        phoneSuffix: phone10 ? phone10.slice(-4) : null
      });
    }

    if (webhookEventDoc && updatedEventCount === 0) {
      const reason = providerIds.length > 0 ? 'provider_id_no_exact_match' : 'missing_provider_id';
      await WhatsAppWebhookEvent.updateOne(
        { _id: webhookEventDoc._id },
        {
          $set: {
            isQuarantined: true,
            quarantineReason: reason,
            quarantineCandidateEventIds: quarantineCandidateEventIds,
            resolvedMessageEventId: null,
            resolvedBy: null
          }
        }
      );
      updatePath = 'quarantined_unmatched';
    } else if (webhookEventDoc && updatedEventCount > 0) {
      await WhatsAppWebhookEvent.updateOne(
        { _id: webhookEventDoc._id },
        {
          $set: {
            isQuarantined: false,
            quarantineReason: null,
            quarantineCandidateEventIds: [],
            resolvedMessageEventId: resolvedMatchId && mongoose.Types.ObjectId.isValid(String(resolvedMatchId))
              ? new mongoose.Types.ObjectId(String(resolvedMatchId))
              : null,
            resolvedBy: updatePath === 'phone_fallback' ? 'phone_fallback' : 'providerIds'
          }
        }
      );
    }

    if (formSubmissionId && deliveryHint && updatedEventCount > 0) {
      const sub = await FormSubmission.findById(formSubmissionId).select('whatsappDeliveryStatus').lean();
      const prevRank = submissionHintRank(sub?.whatsappDeliveryStatus);
      const nextRank = submissionHintRank(deliveryHint);
      if (nextRank >= prevRank) {
        await FormSubmission.updateOne(
          { _id: formSubmissionId },
          {
            $set: {
              whatsappDeliveryStatus: deliveryHint,
              whatsappLastWebhookAt: receivedAt
            }
          }
        );
      }
    }

    console.log('[Gupshup webhook]', {
      rawProviderIds: providerIds,
      resolvedMessageId: matchedProviderId || gsId || payloadId || '(none)',
      stage: stage || null,
      rawStatus: statusRaw || null,
      resolvedStatus: deliveryHint,
      eventStatus: newStatus || null,
      updatePath,
      resolvedMatchId,
      updatedEventCount,
      quarantined: updatedEventCount === 0,
      chatbotDlrUpdated,
      phoneSuffix: phone10 ? phone10.slice(-4) : null,
      matchedBy,
      parseError: parseError || null,
      ...(logBody ? { bodySnippet: rawPayloadSnippet } : {})
    });

    return res.status(200).json({ success: true, received: true });
  } catch (e) {
    console.error('[Gupshup webhook] error:', e.message);
    return res.status(200).json({ success: true, received: false, logged: false });
  }
};
