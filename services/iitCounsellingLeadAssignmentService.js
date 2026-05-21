const mongoose = require('mongoose');
const Bda = require('../models/Bda');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitCounsellingLeadAssignmentHistory = require('../models/IitCounsellingLeadAssignmentHistory');
const IitCounsellingLeadActivity = require('../models/IitCounsellingLeadActivity');

function getAdminActorName(admin) {
  return admin?.username || admin?.name || 'admin';
}

async function loadActiveBda(bdaId) {
  if (!bdaId || !mongoose.Types.ObjectId.isValid(bdaId)) {
    return { error: 'Invalid BDA id' };
  }
  const bda = await Bda.findOne({ _id: bdaId, status: 'active' }).lean();
  if (!bda) return { error: 'Active BDA not found' };
  return { bda };
}

async function logActivity({
  leadId,
  bdaId,
  bdaName,
  admin,
  eventType,
  fromValue,
  toValue,
  remark,
}) {
  return IitCounsellingLeadActivity.create({
    leadId,
    bdaId: bdaId || null,
    bdaName: bdaName || '',
    actorType: 'admin',
    actorId: admin?._id || null,
    actorName: getAdminActorName(admin),
    eventType,
    fromValue: fromValue || '',
    toValue: toValue || '',
    remark: remark || '',
    createdAt: new Date(),
  });
}

async function assignLeadToBda({ leadId, bdaId, admin, reason, isReassign = false }) {
  if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
    return { error: 'Invalid lead id', status: 400 };
  }

  const { bda, error: bdaError } = await loadActiveBda(bdaId);
  if (bdaError) return { error: bdaError, status: 404 };

  const lead = await IitCounsellingSubmission.findOne({
    _id: leadId,
    submissionType: 'iitCounselling',
  });
  if (!lead) return { error: 'Lead not found', status: 404 };

  const previousBdaId = lead.assignedBdaId || null;
  if (isReassign && !previousBdaId) {
    return { error: 'Lead is not assigned yet. Use assign instead.', status: 400 };
  }
  if (previousBdaId && String(previousBdaId) === String(bda._id)) {
    return { error: 'Lead is already assigned to this BDA', status: 400 };
  }

  const now = new Date();
  const assignedBy = getAdminActorName(admin);
  const assignedByAdminName = admin?.name || admin?.username || assignedBy;

  lead.assignedBdaId = bda._id;
  lead.assignedBdaName = bda.name;
  lead.assignedAt = now;
  lead.assignedBy = assignedBy;
  lead.assignedByAdminId = admin?._id || null;
  lead.assignedByAdminName = assignedByAdminName;
  if (!lead.callStatus) lead.callStatus = 'not_called';
  lead.lastActivityAt = now;

  await lead.save();

  const prevBda = previousBdaId
    ? await Bda.findById(previousBdaId).select('name').lean()
    : null;

  await IitCounsellingLeadAssignmentHistory.create({
    leadId: lead._id,
    previousBdaId,
    previousBdaName: prevBda?.name || '',
    newBdaId: bda._id,
    newBdaName: bda.name,
    assignedBy,
    assignedByAdminId: admin?._id || null,
    assignedByAdminName: assignedByAdminName,
    assignedAt: now,
    reason: typeof reason === 'string' ? reason.trim().slice(0, 500) : '',
  });

  await logActivity({
    leadId: lead._id,
    bdaId: bda._id,
    bdaName: bda.name,
    admin,
    eventType: 'assignment',
    fromValue: previousBdaId ? String(previousBdaId) : '',
    toValue: String(bda._id),
    remark: reason || '',
  });

  return { lead };
}

async function bulkAssignLeads({ leadIds, bdaId, admin, reason }) {
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return { error: 'leadIds array is required', status: 400 };
  }
  if (leadIds.length > 200) {
    return { error: 'Maximum 200 leads per request', status: 400 };
  }

  const results = { updated: 0, failed: [] };
  for (const id of leadIds) {
    const out = await assignLeadToBda({
      leadId: id,
      bdaId,
      admin,
      reason,
      isReassign: false,
    });
    if (out.error) {
      results.failed.push({ leadId: id, message: out.error });
    } else {
      results.updated += 1;
    }
  }

  return { results };
}

module.exports = {
  assignLeadToBda,
  bulkAssignLeads,
  logActivity,
  getAdminActorName,
};
