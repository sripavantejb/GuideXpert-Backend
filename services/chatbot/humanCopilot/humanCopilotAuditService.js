'use strict';

function buildAuditEntry({ action, adminId = null, srCounsellor = null, meta = null, at = null }) {
  return {
    action,
    adminId: adminId || null,
    srCounsellor: srCounsellor || null,
    meta: meta || null,
    at: at || new Date(),
  };
}

function mapAuditTrail(trail = []) {
  return (trail || []).map((entry) => ({
    action: entry.action,
    adminId: entry.adminId ? String(entry.adminId) : null,
    srCounsellor: entry.srCounsellor || null,
    meta: entry.meta || null,
    at: entry.at,
  }));
}

function mapCopilotReplies(replies = []) {
  return (replies || []).map((reply) => ({
    id: String(reply._id),
    draftText: reply.draftText,
    status: reply.status,
    adminId: reply.adminId ? String(reply.adminId) : null,
    outboundMessageId: reply.outboundMessageId ? String(reply.outboundMessageId) : null,
    suggestedText: reply.suggestedText || null,
    replySource: reply.replySource || 'manual',
    errorMessage: reply.errorMessage || null,
    createdAt: reply.createdAt,
    sentAt: reply.sentAt || null,
    deliveredAt: reply.deliveredAt || null,
    readAt: reply.readAt || null,
    failedAt: reply.failedAt || null,
  }));
}

module.exports = {
  buildAuditEntry,
  mapAuditTrail,
  mapCopilotReplies,
};
