'use strict';

const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const WhatsAppOutboundMessage = require('../../../models/WhatsAppOutboundMessage');
const { buildAuditEntry } = require('./humanCopilotAuditService');
const { COPILOT_REPLY_STATUSES } = require('./humanCopilotConstants');

const STATUS_RANK = Object.freeze({
  draft: 0,
  sending: 1,
  failed: 2,
  simulated: 3,
  submitted: 4,
  sent: 5,
  delivered: 6,
  read: 7,
});

function mapOutboundStatusToCopilotStatus(outboundStatus) {
  const v = String(outboundStatus || '').toLowerCase();
  if (COPILOT_REPLY_STATUSES.includes(v)) return v;
  if (v === 'queued') return 'submitted';
  return null;
}

function shouldAdvanceReplyStatus(currentStatus, nextStatus) {
  const cur = String(currentStatus || '').toLowerCase();
  const next = String(nextStatus || '').toLowerCase();
  if (!next || cur === next) return false;
  if (cur === 'failed' && next !== 'failed') return false;
  const curRank = STATUS_RANK[cur] ?? -1;
  const nextRank = STATUS_RANK[next] ?? -1;
  return nextRank > curRank;
}

function findReplyForOutbound(handoff, outbound) {
  const replies = handoff.copilotReplies || [];
  if (outbound.copilotReplyId) {
    const byReplyId = replies.find((r) => String(r._id) === String(outbound.copilotReplyId));
    if (byReplyId) return byReplyId;
  }
  return replies.find((r) => String(r.outboundMessageId) === String(outbound._id)) || null;
}

function auditActionForStatus(status) {
  if (status === 'delivered') return 'reply_delivered';
  if (status === 'read') return 'reply_read';
  return null;
}

/**
 * Sync WhatsApp outbound DLR status into copilotReplies + audit trail.
 * @returns {Promise<{ synced: boolean, handoffId?: string, replyId?: string, status?: string }>}
 */
async function syncCopilotReplyFromOutbound({
  outboundId,
  status,
  transitionAt = new Date(),
}) {
  const mapped = mapOutboundStatusToCopilotStatus(status);
  if (!mapped || !outboundId) return { synced: false };

  const outbound = await WhatsAppOutboundMessage.findById(outboundId).lean();
  if (!outbound?.handoffId) return { synced: false };

  const handoff = await WhatsAppAgentHandoff.findById(outbound.handoffId).lean();
  if (!handoff) return { synced: false };

  const reply = findReplyForOutbound(handoff, outbound);
  if (!reply) return { synced: false, handoffId: String(handoff._id) };

  if (!shouldAdvanceReplyStatus(reply.status, mapped)) {
    return {
      synced: false,
      handoffId: String(handoff._id),
      replyId: String(reply._id),
      status: reply.status,
    };
  }

  const patch = { status: mapped };
  if (mapped === 'delivered') patch.deliveredAt = transitionAt;
  if (mapped === 'read') patch.readAt = transitionAt;
  if (mapped === 'sent' && !reply.sentAt) patch.sentAt = transitionAt;
  if (mapped === 'failed') patch.failedAt = transitionAt;

  const set = {};
  for (const [key, value] of Object.entries(patch)) {
    set[`copilotReplies.$.${key}`] = value;
  }

  const auditAction = auditActionForStatus(mapped);
  const update = { $set: set };
  if (auditAction) {
    update.$push = {
      auditTrail: buildAuditEntry({
        action: auditAction,
        adminId: reply.adminId || null,
        srCounsellor: handoff.assignedSrCounsellor,
        meta: { replyId: String(reply._id), outboundMessageId: String(outbound._id) },
        at: transitionAt,
      }),
    };
  }

  await WhatsAppAgentHandoff.updateOne(
    { _id: handoff._id, 'copilotReplies._id': reply._id },
    update
  );

  return {
    synced: true,
    handoffId: String(handoff._id),
    replyId: String(reply._id),
    status: mapped,
  };
}

module.exports = {
  syncCopilotReplyFromOutbound,
  mapOutboundStatusToCopilotStatus,
  shouldAdvanceReplyStatus,
  STATUS_RANK,
};
