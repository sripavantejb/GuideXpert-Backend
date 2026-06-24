/**
 * Apply Gupshup DLR webhooks to WhatsAppOutboundMessage (chatbot session sends).
 */
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const WhatsAppConversation = require('../../models/WhatsAppConversation');
const { messageEventIdMatchClause } = require('../../utils/gupshupMessageIds');
const { canApplyWebhookStatus } = require('../../utils/gupshupWebhookMonotonic');

function mapStageToOutboundStatus(stage) {
  const v = String(stage || '').toLowerCase();
  if (v === 'enqueued' || v === 'submitted') return 'submitted';
  if (v === 'sent') return 'sent';
  if (v === 'delivered') return 'delivered';
  if (v === 'read') return 'read';
  if (v === 'failed') return 'failed';
  return null;
}

function timestampFieldForStatus(status, ts) {
  const d = ts instanceof Date ? ts : new Date();
  if (status === 'sent') return { sentAt: d };
  if (status === 'delivered') return { deliveredAt: d };
  if (status === 'read') return { readAt: d };
  if (status === 'failed') return { failedAt: d };
  return {};
}

/**
 * @returns {Promise<{ updated: boolean, outboundId?: string }>}
 */
async function applyDlrToOutboundMessage({
  providerIds,
  newStatus,
  receivedAt,
  failureCode,
  failureReason,
  transitionTs,
}) {
  const mapped = mapStageToOutboundStatus(newStatus);
  if (!mapped) return { updated: false };

  const idClause = messageEventIdMatchClause(providerIds);
  if (!idClause) return { updated: false };

  const docs = await WhatsAppOutboundMessage.find(idClause).sort({ createdAt: -1 }).limit(5).lean();
  if (!docs.length) return { updated: false };

  const doc = docs[0];
  if (!canApplyWebhookStatus(doc.status, mapped)) {
    return { updated: false, outboundId: String(doc._id) };
  }

  const ts = transitionTs || receivedAt || new Date();
  const setDoc = {
    status: mapped,
    updatedAt: new Date(),
    ...timestampFieldForStatus(mapped, ts),
  };
  if (mapped === 'failed') {
    if (failureCode) setDoc.webhookErrorCode = failureCode;
    if (failureReason) setDoc.webhookErrorReason = failureReason;
  }

  await WhatsAppOutboundMessage.updateOne({ _id: doc._id }, { $set: setDoc });

  if (mapped === 'delivered' || mapped === 'read') {
    await WhatsAppConversation.updateOne(
      { _id: doc.conversationId },
      { $set: { lastOutboundAt: ts, updatedAt: new Date() } }
    );
  }

  try {
    const { syncCopilotReplyFromOutbound } = require('./humanCopilot/humanCopilotDeliverySyncService');
    await syncCopilotReplyFromOutbound({
      outboundId: String(doc._id),
      status: mapped,
      transitionAt: ts,
    });
  } catch (err) {
    console.warn('[chatbotDlr] copilot_delivery_sync_failed', err?.message || err);
  }

  return { updated: true, outboundId: String(doc._id) };
}

module.exports = {
  applyDlrToOutboundMessage,
  mapStageToOutboundStatus,
};
