const mongoose = require('mongoose');
const BdaNotification = require('../models/BdaNotification');
const { getLeadTypeConfig } = require('./bdaLeadTypeRegistry');
const { normalizeBdaLeadType } = require('../constants/bdaLeadTypes');
const { BDA_LEAD_TYPE_LABELS } = require('../constants/bdaLeadTypes');

function getLeadDisplayName(lead, leadType = 'iit_counselling') {
  const config = getLeadTypeConfig(leadType);
  if (config) return config.getDisplayName(lead) || 'Lead';
  return (
    lead?.fullName
    || lead?.studentName
    || lead?.iitCounselling?.section1Data?.fullName
    || lead?.section1Data?.fullName
    || 'Lead'
  ).trim();
}

function getLeadPhone(lead, leadType = 'iit_counselling') {
  const config = getLeadTypeConfig(leadType);
  if (config) return config.getPhone(lead) || '';
  return String(lead?.phone || lead?.mobileNumber || '').trim();
}

function buildMessage(type, { leadName, leadPhone, otherBdaName, leadType }) {
  const typeLabel = BDA_LEAD_TYPE_LABELS[leadType] || '';
  const prefix = typeLabel ? `[${typeLabel}] ` : '';
  const phonePart = leadPhone ? ` (${leadPhone})` : '';
  if (type === 'lead_assigned') {
    return `${prefix}New lead assigned: ${leadName}${phonePart}`;
  }
  if (type === 'lead_reassigned_in') {
    const fromPart = otherBdaName ? ` (from ${otherBdaName})` : '';
    return `${prefix}Lead reassigned to you: ${leadName}${fromPart}`;
  }
  if (type === 'lead_reassigned_out') {
    const toPart = otherBdaName ? ` → ${otherBdaName}` : '';
    return `${prefix}Lead reassigned away: ${leadName}${toPart}`;
  }
  return leadName;
}

async function notifyLeadAssignment({
  leadType: rawLeadType = 'iit_counselling',
  lead,
  previousBdaId,
  prevBdaName,
  newBda,
  admin,
  reason,
}) {
  if (!lead?._id || !newBda?._id) return;

  const leadType = normalizeBdaLeadType(rawLeadType);
  const leadName = getLeadDisplayName(lead, leadType);
  const leadPhone = getLeadPhone(lead, leadType);
  const assignedByAdminName = admin?.name || admin?.username || 'admin';
  const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  const now = new Date();

  const docs = [];

  if (!previousBdaId) {
    docs.push({
      bdaId: newBda._id,
      leadType,
      type: 'lead_assigned',
      leadId: lead._id,
      leadName,
      leadPhone,
      otherBdaName: '',
      assignedByAdminName,
      reason: trimmedReason,
      createdAt: now,
    });
  } else {
    docs.push({
      bdaId: newBda._id,
      leadType,
      type: 'lead_reassigned_in',
      leadId: lead._id,
      leadName,
      leadPhone,
      otherBdaName: prevBdaName || '',
      assignedByAdminName,
      reason: trimmedReason,
      createdAt: now,
    });

    if (String(previousBdaId) !== String(newBda._id)) {
      docs.push({
        bdaId: previousBdaId,
        leadType,
        type: 'lead_reassigned_out',
        leadId: lead._id,
        leadName,
        leadPhone,
        otherBdaName: newBda.name || '',
        assignedByAdminName,
        reason: trimmedReason,
        createdAt: now,
      });
    }
  }

  if (docs.length > 0) {
    await BdaNotification.insertMany(docs);
  }
}

function mapNotificationRow(row) {
  const leadType = normalizeBdaLeadType(row.leadType);
  return {
    id: String(row._id),
    type: row.type,
    leadType,
    leadTypeLabel: BDA_LEAD_TYPE_LABELS[leadType] || leadType,
    leadId: String(row.leadId),
    leadName: row.leadName || '',
    leadPhone: row.leadPhone || '',
    otherBdaName: row.otherBdaName || '',
    assignedByAdminName: row.assignedByAdminName || '',
    reason: row.reason || '',
    message: buildMessage(row.type, { ...row, leadType }),
    readAt: row.readAt || null,
    isRead: !!row.readAt,
    createdAt: row.createdAt,
  };
}

async function listBdaNotifications(bdaId, query = {}) {
  if (!bdaId || !mongoose.Types.ObjectId.isValid(bdaId)) {
    return { error: 'Invalid BDA id', status: 400 };
  }

  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;
  const unreadOnly = query.unreadOnly === 'true' || query.unreadOnly === true;

  const filter = { bdaId: new mongoose.Types.ObjectId(bdaId) };
  if (unreadOnly) filter.readAt = null;

  const [rows, total, unreadCount] = await Promise.all([
    BdaNotification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    BdaNotification.countDocuments(filter),
    BdaNotification.countDocuments({ bdaId: filter.bdaId, readAt: null }),
  ]);

  return {
    data: rows.map(mapNotificationRow),
    unreadCount,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
}

async function markBdaNotificationsRead(bdaId, { ids = [], all = false } = {}) {
  if (!bdaId || !mongoose.Types.ObjectId.isValid(bdaId)) {
    return { error: 'Invalid BDA id', status: 400 };
  }

  const now = new Date();
  const filter = { bdaId: new mongoose.Types.ObjectId(bdaId), readAt: null };

  if (all) {
    const result = await BdaNotification.updateMany(filter, { $set: { readAt: now } });
    return { updated: result.modifiedCount || 0 };
  }

  const validIds = (Array.isArray(ids) ? ids : [])
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (validIds.length === 0) {
    return { error: 'ids array is required unless all is true', status: 400 };
  }

  filter._id = { $in: validIds };
  const result = await BdaNotification.updateMany(filter, { $set: { readAt: now } });
  return { updated: result.modifiedCount || 0 };
}

module.exports = {
  notifyLeadAssignment,
  listBdaNotifications,
  markBdaNotificationsRead,
  buildMessage,
};
