'use strict';

const ConversationRecoveryAuditLog = require('../../models/ConversationRecoveryAuditLog');

async function writeAuditLog({
  admin,
  action,
  targetCaseId = null,
  targetPhone = null,
  targetStudent = null,
  reason = null,
  ip = null,
  oldValue = null,
  newValue = null,
  metadata = {},
} = {}) {
  try {
    return await ConversationRecoveryAuditLog.create({
      adminId: admin?._id ? String(admin._id) : admin?.id || null,
      adminEmail: admin?.email || null,
      action: String(action || 'unknown'),
      targetCaseId,
      targetPhone,
      targetStudent,
      reason,
      ip,
      oldValue,
      newValue,
      metadata,
    });
  } catch (err) {
    console.warn('[conversationRecovery] audit write failed:', err?.message || err);
    return null;
  }
}

async function listAuditLogs({ page = 1, limit = 50, action = null } = {}) {
  const match = {};
  if (action) match.action = action;
  const skip = (Math.max(1, page) - 1) * limit;
  const [items, total] = await Promise.all([
    ConversationRecoveryAuditLog.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ConversationRecoveryAuditLog.countDocuments(match),
  ]);
  return { total, page, limit, items };
}

function clientIp(req) {
  const xf = req?.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req?.ip || req?.socket?.remoteAddress || null;
}

module.exports = {
  writeAuditLog,
  listAuditLogs,
  clientIp,
};
