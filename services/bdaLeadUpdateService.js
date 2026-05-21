const mongoose = require('mongoose');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const LeadCallHistory = require('../models/LeadCallHistory');
const IitCounsellingLeadActivity = require('../models/IitCounsellingLeadActivity');
const {
  CALL_STATUS,
  LEAD_STATUS,
  DEMO_STATUS,
  NIAT_STATUS,
  PAYMENT_STATUS,
} = require('../constants/bdaLeadCrm');
const { mapIitCounsellingLeadToDTO } = require('../utils/iitCounsellingLeadDto');
const IitCounsellingVisit = require('../models/IitCounsellingVisit');

function buildCallbackDateTime(callbackDate, callbackTime) {
  if (!callbackDate) return null;
  const d = new Date(callbackDate);
  if (Number.isNaN(d.getTime())) return null;
  if (callbackTime && typeof callbackTime === 'string') {
    const m = callbackTime.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    }
  }
  return d;
}

async function logCallHistory({
  leadId,
  bdaId,
  bdaName,
  snapshot,
  actorType = 'bda',
  actorName = '',
}) {
  await LeadCallHistory.create({
    leadId,
    bdaId: bdaId || null,
    bdaName: bdaName || '',
    callStatus: snapshot.callStatus || '',
    leadStatus: snapshot.leadStatus || '',
    demoStatus: snapshot.demoStatus || '',
    niatRegistrationStatus: snapshot.niatStatus || '',
    paymentStatus: snapshot.paymentStatus || '',
    callbackNeeded: !!snapshot.callbackNeeded,
    callbackDateTime: snapshot.callbackDateTime || null,
    callbackNote: snapshot.callbackNote || '',
    remark: snapshot.remark || '',
    actorType,
    actorName,
    createdAt: new Date(),
  });
}

async function logLegacyActivity({ leadId, bdaId, bdaName, admin, eventType, remark }) {
  return IitCounsellingLeadActivity.create({
    leadId,
    bdaId: bdaId || null,
    bdaName: bdaName || '',
    actorType: admin ? 'admin' : 'bda',
    actorId: admin?._id || bdaId || null,
    actorName: admin?.username || admin?.name || bdaName || 'bda',
    eventType: 'remark',
    fromValue: '',
    toValue: eventType,
    remark: remark || '',
    createdAt: new Date(),
  });
}

/**
 * Update CRM fields on a lead assigned to the given BDA.
 * @returns {{ lead?: object, error?: string, status?: number }}
 */
async function updateLeadByBda({ leadId, bda, body }) {
  if (!mongoose.Types.ObjectId.isValid(leadId)) {
    return { error: 'Lead not found', status: 404 };
  }

  const lead = await IitCounsellingSubmission.findOne({
    _id: leadId,
    submissionType: 'iitCounselling',
    assignedBdaId: bda._id,
  });
  if (!lead) {
    return { error: 'Lead not found or not assigned to you', status: 403 };
  }

  const remark = typeof body.remark === 'string' ? body.remark.trim().slice(0, 2000) : '';
  if (!remark) {
    return { error: 'Remark is required when updating lead', status: 400 };
  }

  const applyEnum = (field, allowed) => {
    if (body[field] === undefined) return;
    const next = typeof body[field] === 'string' ? body[field].trim() : body[field];
    if (next === '' || next === null) {
      if (field === 'leadStatus') lead.leadStatus = undefined;
      return;
    }
    if (!allowed.includes(next)) {
      throw new Error(`Invalid ${field}`);
    }
    lead[field] = next;
  };

  try {
    applyEnum('callStatus', CALL_STATUS);
    applyEnum('leadStatus', LEAD_STATUS);
    applyEnum('demoStatus', DEMO_STATUS);
    applyEnum('niatStatus', NIAT_STATUS);
    applyEnum('paymentStatus', PAYMENT_STATUS);
  } catch (e) {
    return { error: e.message, status: 400 };
  }

  if (body.callbackNeeded !== undefined) {
    lead.callbackNeeded = body.callbackNeeded === true || body.callbackNeeded === 'yes';
  }

  if (lead.callbackNeeded) {
    const dt = buildCallbackDateTime(body.callbackDate, body.callbackTime);
    if (!dt) {
      return { error: 'Callback date and time are required when callback is needed', status: 400 };
    }
    lead.callbackDateTime = dt;
    lead.callbackDate = dt;
    if (body.callbackNote !== undefined) {
      lead.callbackNote = typeof body.callbackNote === 'string' ? body.callbackNote.trim().slice(0, 500) : '';
    }
  } else if (body.callbackNeeded === false || body.callbackNeeded === 'no') {
    lead.callbackDateTime = null;
    lead.callbackDate = null;
    lead.callbackNote = '';
  }

  const now = new Date();
  lead.lastRemark = remark;
  lead.latestRemark = remark;
  lead.lastUpdatedBy = bda.name;
  lead.lastUpdatedByRole = 'bda';
  lead.lastUpdatedAt = now;
  lead.crmUpdatedAt = now;
  lead.lastActivityAt = now;

  await lead.save();

  const snapshot = {
    callStatus: lead.callStatus,
    leadStatus: lead.leadStatus || '',
    demoStatus: lead.demoStatus,
    niatStatus: lead.niatStatus,
    paymentStatus: lead.paymentStatus,
    callbackNeeded: lead.callbackNeeded,
    callbackDateTime: lead.callbackDateTime,
    callbackNote: lead.callbackNote,
    remark,
  };

  await logCallHistory({
    leadId: lead._id,
    bdaId: bda._id,
    bdaName: bda.name,
    snapshot,
    actorType: 'bda',
    actorName: bda.name,
  });

  await logLegacyActivity({
    leadId: lead._id,
    bdaId: bda._id,
    bdaName: bda.name,
    eventType: 'crm_update',
    remark,
  });

  const visit = await IitCounsellingVisit.findOne({ submissionId: lead._id }).sort({ visitedAt: -1 }).lean();
  return { lead: mapIitCounsellingLeadToDTO(lead.toObject(), visit) };
}

module.exports = {
  updateLeadByBda,
  logCallHistory,
  buildCallbackDateTime,
};
