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
const { isRetryableFailure, isCampaignStrategy, RETRY_EXCLUSION_REASON } = require('../utils/whatsappRetryRules');

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
  const best = (arr) => (arr.length ? arr.sort((a, b) => b.score - a.score)[0].value : null);
  const gsId = best(gsIdCandidates);
  const payloadId = best(payloadIdCandidates);
  const phone10 = best(phoneCandidates);
  const status = best(statusCandidates);
  const eventType = best(eventTypeCandidates);
  const providerIds = [...new Set([gsId, payloadId].filter(Boolean))];
  const deliveryHint = eventType ? normalizeDeliveryHint(eventType) : (normalizeDeliveryHint(status) || null);
  return {
    gsId,
    payloadId,
    providerIds,
    phone10,
    statusRaw: status || eventType || null,
    eventType: eventType || null,
    deliveryHint,
    status,
    parseError
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
  const failureCode = explicit?.failureCode || null;
  const failureReason = explicit?.failureReason || null;
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
  const statusMayChange = newStatus && canApplyWebhookStatus(doc.status, newStatus);
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
        set.retryEligible = false;
        set.terminalFailureKind = 'transient';
        set.retryExclusionReason = null;
        set.retryExclusionAt = null;
        set['retryExclusionMeta.nextAttempt'] = null;
        set['retryExclusionMeta.attemptBatchId'] = null;
        set['retryExclusionMeta.note'] = 'webhook_failed_after_provider_accept';
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
      if (failureReason) set.webhookErrorReason = failureReason;
    }
    if (newStatus === 'delivered' || newStatus === 'read') {
      set.retryEligible = false;
      set.retryExclusionReason = 'already_delivered_or_read';
      set.retryExclusionAt = receivedAt;
      set['retryExclusionMeta.note'] = 'webhook_recovery';
    }
  }

  const res = await WhatsAppMessageEvent.updateOne(
    { _id: doc._id },
    { $set: set }
  );
  return { modified: (res.modifiedCount || 0) > 0, reason: 'updated' };
}

exports.ingestGupshupWebhook = async (req, res) => {
  const receivedAt = new Date();
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
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
    try {
      webhookEventDoc = await WhatsAppWebhookEvent.create({
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
    const tryUpdateDocs = async (query) => {
      const docs = await WhatsAppMessageEvent.find(query).limit(25).lean();
      quarantineCandidateEventIds = docs.map((d) => d._id).slice(0, 25);
      if (docs.length > 1) {
        console.warn('[Gupshup webhook] provider_id_multi_match', {
          count: docs.length,
          eventIds: docs.map((d) => String(d._id)).slice(0, 12),
          attemptNumbers: docs.map((d) => d.attemptNumber).filter((x) => x != null)
        });
      }
      if (docs.length > 1) {
        return 0;
      }
      let n = 0;
      for (const d of docs) {
        if (!newStatus) continue;
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
          n += 1;
          resolvedMatchId = String(d._id);
        }
      }
      return n;
    };

    if (newStatus && providerIds.length > 0) {
      const idClause = messageEventIdMatchClause(providerIds);
      if (idClause) {
        const n = await tryUpdateDocs(idClause);
        updatedEventCount = n;
        if (n > 0) {
          updatePath = 'providerIds';
        }
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
            resolvedBy: 'providerIds'
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
