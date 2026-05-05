const FormSubmission = require('../models/FormSubmission');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');

function sanitizeSnippet(raw, maxLen = 3800) {
  if (raw == null) return null;
  let s = typeof raw === 'string' ? raw : JSON.stringify(raw);
  s = s.replace(/apikey["']?\s*[:=]\s*["'][^"']+/gi, 'apikey":"***');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

function mapDeliveryHintToEventStatus(deliveryHint) {
  if (deliveryHint === 'read') return 'read';
  if (deliveryHint === 'delivered') return 'delivered';
  if (deliveryHint === 'failed') return 'failed';
  return 'submitted';
}

function normalizeDeliveryHint(raw) {
  const v = raw == null ? '' : String(raw).trim().toLowerCase();
  if (!v) return null;
  if (v === 'enqueued') return 'sent';
  if (v.includes('read')) return 'read';
  if (v.includes('delivered') || v.includes('delivery')) return 'delivered';
  if (v.includes('fail') || v.includes('error') || v.includes('undeliver')) return 'failed';
  if (v.includes('sent') || v.includes('submit') || v.includes('enqueue') || v.includes('queued')) return 'sent';
  return v;
}

function normalizeEventType(raw) {
  const v = raw == null ? '' : String(raw).trim().toLowerCase();
  if (!v) return null;
  if (['enqueued', 'sent', 'delivered', 'read', 'failed'].includes(v)) return v;
  return null;
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

exports.ingestGupshupWebhook = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const extracted = extractWebhookFields(body);
    const {
      gsId,
      payloadId,
      providerIds,
      phone10,
      statusRaw,
      eventType,
      deliveryHint: extractedDeliveryHint,
      parseError
    } = extracted;

    const receivedAt = new Date();
    const rawPayloadSnippet = sanitizeSnippet(body);

    let formSubmissionId = null;
    let matchedBy = null;
    let matchConfidence = null;
    let matchedProviderId = null;

    if (providerIds.length > 0) {
      const sub = await FormSubmission.findOne({ whatsappLastMessageId: { $in: providerIds } })
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

    await WhatsAppWebhookEvent.create({
      receivedAt,
      messageId: matchedProviderId || gsId || payloadId || null,
      phone: phone10 || null,
      status: statusRaw || null,
      formSubmissionId,
      rawPayloadSnippet,
      matchedBy,
      matchConfidence,
      parseError
    });

    const deliveryHint = extractedDeliveryHint || 'unknown';
    const evtStatus = mapDeliveryHintToEventStatus(deliveryHint);
    let updatePath = 'none';
    let updatedEventCount = 0;
    let resolvedMatchId = null;

    if (providerIds.length > 0) {
      const updateRes = await WhatsAppMessageEvent.updateMany(
        { gupshupMessageId: { $in: providerIds } },
        { $set: { status: evtStatus, updatedAt: receivedAt } }
      );
      updatedEventCount = updateRes?.modifiedCount || 0;
      if (updatedEventCount > 0) {
        updatePath = 'providerIds';
        resolvedMatchId = providerIds.find(Boolean) || null;
      }
    }

    if (updatedEventCount === 0 && formSubmissionId && phone10) {
      const recentWindow = new Date(receivedAt.getTime() - 24 * 60 * 60 * 1000);
      let targetEvent = await WhatsAppMessageEvent.findOne({
        formSubmissionId,
        phone: phone10,
        createdAt: { $gte: recentWindow },
        status: { $in: ['queued', 'submitted', 'retry_pending'] }
      }).sort({ createdAt: -1 }).select('_id').lean();
      if (!targetEvent) {
        targetEvent = await WhatsAppMessageEvent.findOne({
          formSubmissionId,
          phone: phone10,
          createdAt: { $gte: recentWindow }
        }).sort({ createdAt: -1 }).select('_id').lean();
      }
      if (targetEvent?._id) {
        const updateRes = await WhatsAppMessageEvent.updateOne(
          { _id: targetEvent._id },
          { $set: { status: evtStatus, updatedAt: receivedAt } }
        );
        updatedEventCount = updateRes?.modifiedCount || 0;
        if (updatedEventCount > 0) {
          updatePath = 'submissionPhoneFallback';
          resolvedMatchId = String(targetEvent._id);
        }
      }
    }

    if (updatedEventCount === 0 && phone10) {
      const recentWindow = new Date(receivedAt.getTime() - 24 * 60 * 60 * 1000);
      // Message-id-less (or wrong-id) webhooks are ambiguous. Update only one best candidate
      // to avoid inflating delivered/read counts by touching every recent event.
      let targetEvent = await WhatsAppMessageEvent.findOne({
        phone: phone10,
        createdAt: { $gte: recentWindow },
        status: { $in: ['queued', 'submitted', 'retry_pending'] }
      })
        .sort({ createdAt: -1 })
        .select('_id')
        .lean();

      if (!targetEvent) {
        targetEvent = await WhatsAppMessageEvent.findOne({
          phone: phone10,
          createdAt: { $gte: recentWindow }
        })
          .sort({ createdAt: -1 })
          .select('_id')
          .lean();
      }

      if (targetEvent?._id) {
        const updateRes = await WhatsAppMessageEvent.updateOne(
          { _id: targetEvent._id },
          { $set: { status: evtStatus, updatedAt: receivedAt } }
        );
        updatedEventCount = updateRes?.modifiedCount || 0;
        if (updatedEventCount > 0) {
          updatePath = 'phoneFallback';
          resolvedMatchId = String(targetEvent._id);
        }
      }
    }

    if (formSubmissionId) {
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

    console.log('[Gupshup webhook]', {
      rawProviderIds: providerIds,
      resolvedMessageId: matchedProviderId || gsId || payloadId || '(none)',
      eventType: eventType || null,
      rawStatus: statusRaw || null,
      resolvedStatus: deliveryHint,
      eventStatus: evtStatus,
      updatePath,
      resolvedMatchId,
      updatedEventCount,
      phoneSuffix: phone10 ? phone10.slice(-4) : null,
      matchedBy,
      parseError: parseError || null
    });

    return res.status(200).json({ success: true, received: true });
  } catch (e) {
    console.error('[Gupshup webhook] error:', e.message);
    return res.status(200).json({ success: true, received: false, logged: false });
  }
};
