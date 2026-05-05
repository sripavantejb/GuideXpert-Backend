const FormSubmission = require('../models/FormSubmission');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');

function sanitizeSnippet(raw, maxLen = 3800) {
  if (raw == null) return null;
  let s = typeof raw === 'string' ? raw : JSON.stringify(raw);
  s = s.replace(/apikey["']?\s*[:=]\s*["'][^"']+/gi, 'apikey":"***');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

/**
 * Extract message id, recipient phone (10-digit IN), inbound status text from heterogeneous Gupshup payloads.
 */
function extractWebhookFields(body) {
  let root = body;
  if (body && typeof body.payload === 'string') {
    try {
      root = JSON.parse(body.payload);
    } catch {
      root = body;
    }
  }

  const candidates = [];

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

    const id =
      node.id ||
      node.messageId ||
      node.message_id ||
      (node.message && node.message.id) ||
      node.gsId ||
      node.GsSentMessageId;

    let phone =
      node.source ||
      node.mobile ||
      node.phone ||
      node.recipient ||
      (node.destination && String(node.destination)) ||
      node.waNumber;

    let status =
      node.status ||
      node.eventType ||
      node.type ||
      node.event ||
      (node.payload && node.payload.status) ||
      (node.messageStatus && node.messageStatus.status);

    if (id || phone || status) {
      candidates.push({ id: id ? String(id) : null, phone: phone ? String(phone) : null, status: status ? String(status) : null });
    }

    Object.values(node).forEach((x) => visit(x, depth + 1));
  }

  visit(root, 0);

  const scored = candidates
    .filter((c) => c.id || c.status)
    .sort((a, b) => (b.id ? 1 : 0) - (a.id ? 1 : 0));

  const pick = scored[0] || {};
  let phone10 = null;
  if (pick.phone) {
    const d = pick.phone.replace(/\D/g, '');
    phone10 = d.length >= 10 ? d.slice(-10) : null;
  }
  return {
    messageId: pick.id ? String(pick.id) : null,
    phone10,
    status: pick.status ? String(pick.status) : null
  };
}

exports.ingestGupshupWebhook = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { messageId, phone10, status } = extractWebhookFields(body);

    const receivedAt = new Date();
    const rawPayloadSnippet = sanitizeSnippet(body);

    let formSubmissionId = null;
    if (messageId) {
      const sub = await FormSubmission.findOne({ whatsappLastMessageId: messageId }).select('_id phone').lean();
      if (sub) formSubmissionId = sub._id;
    }
    if (!formSubmissionId && phone10) {
      const sub2 = await FormSubmission.findOne({ phone: phone10 }).select('_id').lean();
      if (sub2) formSubmissionId = sub2._id;
    }

    await WhatsAppWebhookEvent.create({
      receivedAt,
      messageId,
      phone: phone10 || null,
      status: status || null,
      formSubmissionId,
      rawPayloadSnippet
    });

    const normStatus = status ? status.toLowerCase() : '';

    const deliveryHint =
      normStatus.includes('read')
        ? 'read'
        : normStatus.includes('delivered') || normStatus.includes('delivery')
          ? 'delivered'
          : normStatus.includes('fail') || normStatus.includes('error')
            ? 'failed'
            : normStatus.includes('sent') || normStatus.includes('submit')
              ? 'sent'
              : normStatus || 'unknown';

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

    if (messageId) {
      const evtStatus =
        deliveryHint === 'read'
          ? 'read'
          : deliveryHint === 'delivered'
            ? 'delivered'
            : deliveryHint === 'failed'
              ? 'failed'
              : 'submitted';

      await WhatsAppMessageEvent.updateMany(
        { gupshupMessageId: messageId },
        {
          $set: { status: evtStatus, updatedAt: receivedAt }
        }
      );
    }

    console.log('[Gupshup webhook]', { messageId: messageId || '(none)', status: deliveryHint, phoneSuffix: phone10 ? phone10.slice(-4) : null });

    return res.status(200).json({ success: true, received: true });
  } catch (e) {
    console.error('[Gupshup webhook] error:', e.message);
    return res.status(200).json({ success: true, received: false, logged: false });
  }
};
