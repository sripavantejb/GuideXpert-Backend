const mongoose = require('mongoose');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const LeadCallHistory = require('../models/LeadCallHistory');
const {
  mapIitCounsellingLeadToDTO,
  IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
} = require('../utils/iitCounsellingLeadDto');
const IitCounsellingVisit = require('../models/IitCounsellingVisit');

function bdaLeadFilter(bdaId) {
  return {
    submissionType: 'iitCounselling',
    assignedBdaId: new mongoose.Types.ObjectId(bdaId),
  };
}

function connectedMatch() {
  return { $in: ['call_connected', 'connected'] };
}

function paymentPaidMatch() {
  return { $in: ['amount_paid', 'paid'] };
}

function paymentInitiatedMatch() {
  return { $in: ['payment_initiated', 'initiated'] };
}

async function getBdaDashboardStats(bdaId) {
  const base = bdaLeadFilter(bdaId);
  const [
    totalAssigned,
    notCalled,
    connected,
    notConnected,
    interested,
    notInterested,
    demoScheduled,
    demoAttended,
    demoNotAttended,
    niatRegistered,
    paymentInitiated,
    amountPaid,
    callbackPending,
    converted,
    lost,
  ] = await Promise.all([
    IitCounsellingSubmission.countDocuments(base),
    IitCounsellingSubmission.countDocuments({ ...base, callStatus: 'not_called' }),
    IitCounsellingSubmission.countDocuments({ ...base, callStatus: { $in: ['call_connected', 'connected'] } }),
    IitCounsellingSubmission.countDocuments({ ...base, callStatus: 'not_connected' }),
    IitCounsellingSubmission.countDocuments({ ...base, leadStatus: 'interested' }),
    IitCounsellingSubmission.countDocuments({ ...base, leadStatus: 'not_interested' }),
    IitCounsellingSubmission.countDocuments({
      ...base,
      demoStatus: { $in: ['demo_scheduled', 'scheduled'] },
    }),
    IitCounsellingSubmission.countDocuments({ ...base, demoStatus: 'attended' }),
    IitCounsellingSubmission.countDocuments({ ...base, demoStatus: 'not_attended' }),
    IitCounsellingSubmission.countDocuments({
      ...base,
      niatStatus: { $in: ['registered', 'registration_initiated'] },
    }),
    IitCounsellingSubmission.countDocuments({
      ...base,
      paymentStatus: { $in: ['payment_initiated', 'initiated'] },
    }),
    IitCounsellingSubmission.countDocuments({
      ...base,
      paymentStatus: { $in: ['amount_paid', 'paid'] },
    }),
    IitCounsellingSubmission.countDocuments({
      ...base,
      $or: [
        { callbackNeeded: true },
        { leadStatus: { $in: ['callback_pending', 'call_back_needed'] } },
      ],
    }),
    IitCounsellingSubmission.countDocuments({ ...base, leadStatus: 'converted' }),
    IitCounsellingSubmission.countDocuments({ ...base, leadStatus: 'lost' }),
  ]);

  return {
    totalAssignedLeads: totalAssigned,
    notCalled,
    callConnected: connected,
    notConnected,
    interested,
    notInterested,
    demoScheduled,
    demoAttended,
    demoNotAttended,
    niatRegistered,
    paymentInitiated,
    amountPaid,
    callbackPending,
    converted,
    lost,
  };
}

async function listBdaLeads(bdaId, query = {}) {
  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(10, parseInt(query.limit, 10) || 25));
  const skip = (pageNum - 1) * limitNum;

  const filter = bdaLeadFilter(bdaId);

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const nameQ = typeof query.name === 'string' ? query.name.trim() : '';
  const phoneQ = typeof query.phone === 'string' ? query.phone.trim() : '';
  const search = q || nameQ;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { fullName: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped } },
    ];
  }
  if (phoneQ && !search) {
    filter.phone = { $regex: phoneQ.replace(/\D/g, '') };
  }
  if (query.callStatus) filter.callStatus = query.callStatus;
  if (query.leadStatus) filter.leadStatus = query.leadStatus;
  if (query.demoStatus) filter.demoStatus = query.demoStatus;
  if (query.niatStatus) filter.niatStatus = query.niatStatus;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.callbackNeeded === 'true' || query.callbackNeeded === true) filter.callbackNeeded = true;
  if (query.callbackNeeded === 'false' || query.callbackNeeded === false) filter.callbackNeeded = false;

  if (query.callbackDateFrom || query.callbackDateTo) {
    filter.callbackDateTime = {};
    if (query.callbackDateFrom) {
      const d = new Date(query.callbackDateFrom);
      if (!Number.isNaN(d.getTime())) filter.callbackDateTime.$gte = d;
    }
    if (query.callbackDateTo) {
      const d = new Date(query.callbackDateTo);
      if (!Number.isNaN(d.getTime())) filter.callbackDateTime.$lte = d;
    }
  }

  if (query.updatedFrom || query.updatedTo) {
    filter.lastUpdatedAt = {};
    if (query.updatedFrom) {
      const d = new Date(query.updatedFrom);
      if (!Number.isNaN(d.getTime())) filter.lastUpdatedAt.$gte = d;
    }
    if (query.updatedTo) {
      const d = new Date(query.updatedTo);
      if (!Number.isNaN(d.getTime())) filter.lastUpdatedAt.$lte = d;
    }
  }

  const dedupePipeline = [
    { $match: filter },
    IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
    { $sort: { lastUpdatedAt: -1, updatedAt: -1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$phoneKey', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $project: { phoneKey: 0, _demoSortKey: 0 } },
    { $sort: { lastUpdatedAt: -1, updatedAt: -1, createdAt: -1, _id: -1 } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limitNum }],
        meta: [{ $count: 'total' }],
      },
    },
  ];

  const aggOut = await IitCounsellingSubmission.aggregate(dedupePipeline);
  const facet = Array.isArray(aggOut) && aggOut[0] ? aggOut[0] : { data: [], meta: [] };
  const rows = facet.data || [];
  const total = facet.meta?.[0]?.total ?? 0;

  const submissionIds = rows.map((r) => r._id).filter(Boolean);
  const visitsBySubmissionId = new Map();
  if (submissionIds.length > 0) {
    const visits = await IitCounsellingVisit.find({ submissionId: { $in: submissionIds } })
      .sort({ visitedAt: -1 })
      .lean();
    for (const v of visits) {
      const key = String(v.submissionId);
      if (!visitsBySubmissionId.has(key)) visitsBySubmissionId.set(key, v);
    }
  }

  const data = rows.map((sub) =>
    mapIitCounsellingLeadToDTO(sub, visitsBySubmissionId.get(String(sub._id)))
  );

  return {
    data,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
}

async function getBdaLeadById(bdaId, leadId) {
  if (!mongoose.Types.ObjectId.isValid(leadId)) return null;
  const lead = await IitCounsellingSubmission.findOne({
    _id: leadId,
    ...bdaLeadFilter(bdaId),
  }).lean();
  if (!lead) return null;
  const visit = await IitCounsellingVisit.findOne({ submissionId: lead._id }).sort({ visitedAt: -1 }).lean();
  return mapIitCounsellingLeadToDTO(lead, visit);
}

async function getLeadCallHistory(bdaId, leadId) {
  const lead = await IitCounsellingSubmission.findOne({
    _id: leadId,
    ...bdaLeadFilter(bdaId),
  }).select('_id').lean();
  if (!lead) return null;

  const rows = await LeadCallHistory.find({ leadId: lead._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return rows.map((r) => ({
    id: String(r._id),
    leadId: String(r.leadId),
    bdaId: r.bdaId ? String(r.bdaId) : '',
    bdaName: r.bdaName || r.actorName || '',
    callStatus: r.callStatus,
    leadStatus: r.leadStatus,
    demoStatus: r.demoStatus,
    niatRegistrationStatus: r.niatRegistrationStatus,
    paymentStatus: r.paymentStatus,
    callbackNeeded: r.callbackNeeded,
    callbackDateTime: r.callbackDateTime,
    callbackNote: r.callbackNote,
    remark: r.remark,
    createdAt: r.createdAt,
  }));
}

module.exports = {
  getBdaDashboardStats,
  listBdaLeads,
  getBdaLeadById,
  getLeadCallHistory,
};
