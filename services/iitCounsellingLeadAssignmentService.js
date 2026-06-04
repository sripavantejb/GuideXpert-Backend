const mongoose = require('mongoose');
const Bda = require('../models/Bda');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const {
  parseBdaLeadFilterQuery,
  fetchDedupedAssignedLeadIds,
} = require('./bdaLeadFilterService');
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

async function bulkAssignLeads({ leadIds, bdaId, admin, reason, respectExistingBda = false }) {
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return { error: 'leadIds array is required', status: 400 };
  }
  if (leadIds.length > 200) {
    return { error: 'Maximum 200 leads per request', status: 400 };
  }

  const results = { updated: 0, skippedSameBda: 0, failed: [] };

  for (const id of leadIds) {
    let targetBdaId = bdaId;
    let isReassign = false;

    if (respectExistingBda) {
      const lead = await IitCounsellingSubmission.findOne({
        _id: id,
        submissionType: 'iitCounselling',
      })
        .select('assignedBdaId')
        .lean();
      if (!lead) {
        results.failed.push({ leadId: id, message: 'Lead not found' });
        continue;
      }
      if (lead.assignedBdaId) {
        targetBdaId = String(lead.assignedBdaId);
        isReassign = true;
      }
    }

    const out = await assignLeadToBda({
      leadId: id,
      bdaId: targetBdaId,
      admin,
      reason,
      isReassign,
    });
    if (out.error) {
      if (
        respectExistingBda &&
        out.error === 'Lead is already assigned to this BDA' &&
        isReassign
      ) {
        results.skippedSameBda += 1;
        results.updated += 1;
        continue;
      }
      results.failed.push({ leadId: id, message: out.error });
    } else {
      results.updated += 1;
    }
  }

  return { results };
}

/** Re-apply each lead's existing assignedBdaId (meet-filter batches). Skips leads with no prior BDA. */
async function bulkMapToRespectiveBda({ leadIds, admin, reason }) {
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return { error: 'leadIds array is required', status: 400 };
  }
  if (leadIds.length > 200) {
    return { error: 'Maximum 200 leads per request', status: 400 };
  }

  const results = { updated: 0, skippedSameBda: 0, skippedUnassigned: 0, failed: [] };

  for (const id of leadIds) {
    const lead = await IitCounsellingSubmission.findOne({
      _id: id,
      submissionType: 'iitCounselling',
    })
      .select('assignedBdaId')
      .lean();

    if (!lead) {
      results.failed.push({ leadId: id, message: 'Lead not found' });
      continue;
    }
    if (!lead.assignedBdaId) {
      results.skippedUnassigned += 1;
      continue;
    }

    const out = await assignLeadToBda({
      leadId: id,
      bdaId: String(lead.assignedBdaId),
      admin,
      reason,
      isReassign: true,
    });
    if (out.error) {
      if (out.error === 'Lead is already assigned to this BDA') {
        results.skippedSameBda += 1;
        results.updated += 1;
        continue;
      }
      results.failed.push({ leadId: id, message: out.error });
    } else {
      results.updated += 1;
    }
  }

  return { results };
}

const MAP_FILTERED_MAX = 2000;

/** Map every previously assigned lead in the active meet filter to its own BDA. */
async function bulkMapFilteredToRespectiveBda({ filterQuery, admin, reason }) {
  const parsed = parseBdaLeadFilterQuery(filterQuery);
  if (!parsed.keepExistingBda) {
    return {
      error: 'Enable “map to respective BDA” (keepExistingBda) for this action',
      status: 400,
    };
  }
  if (!parsed.meetPresence) {
    return {
      error: 'Set Meet attendance to Attended or Did not attend meet before mapping',
      status: 400,
    };
  }

  const leadIds = await fetchDedupedAssignedLeadIds(filterQuery);
  if (leadIds.length === 0) {
    return {
      results: { updated: 0, skippedSameBda: 0, skippedUnassigned: 0, failed: [], total: 0 },
    };
  }
  if (leadIds.length > MAP_FILTERED_MAX) {
    return {
      error: `Too many leads (${leadIds.length}). Narrow meet date or other filters (max ${MAP_FILTERED_MAX}).`,
      status: 400,
    };
  }

  const merged = { updated: 0, skippedSameBda: 0, skippedUnassigned: 0, failed: [], total: leadIds.length };
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const out = await bulkMapToRespectiveBda({ leadIds: chunk, admin, reason });
    if (out.error) return out;
    merged.updated += out.results.updated;
    merged.skippedSameBda += out.results.skippedSameBda;
    merged.skippedUnassigned += out.results.skippedUnassigned;
    merged.failed.push(...(out.results.failed || []));
  }

  return { results: merged };
}

module.exports = {
  assignLeadToBda,
  bulkAssignLeads,
  bulkMapToRespectiveBda,
  bulkMapFilteredToRespectiveBda,
  logActivity,
  getAdminActorName,
};
