const mongoose = require('mongoose');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const LeadCallHistory = require('../models/LeadCallHistory');
const {
  mapIitCounsellingLeadToDTO,
  IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
} = require('../utils/iitCounsellingLeadDto');
const IitCounsellingVisit = require('../models/IitCounsellingVisit');
const { normalizeBdaLeadType, BDA_LEAD_TYPES } = require('../constants/bdaLeadTypes');
const { getLeadTypeConfig, findOwnedLeadForBda, REGISTRY } = require('./bdaLeadTypeRegistry');

function bdaLeadFilter(bdaId, bdaLanguage = '') {
  const filter = {
    submissionType: 'iitCounselling',
    assignedBdaId: new mongoose.Types.ObjectId(bdaId),
  };
  if (bdaLanguage === 'Hindi' || bdaLanguage === 'Telugu') {
    filter['iitCounselling.section2Data.preferredLanguage'] = bdaLanguage;
  }
  return filter;
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

async function getBdaDashboardStats(bdaId, bdaLanguage = '') {
  const base = bdaLeadFilter(bdaId, bdaLanguage);
  const bdaObjectId = new mongoose.Types.ObjectId(bdaId);
  const otherAssignedCounts = await Promise.all(
    ['counsellor', 'one_on_one'].map(async (leadType) => {
      const config = getLeadTypeConfig(leadType);
      const count = await config.model.countDocuments({
        ...config.ownershipFilter,
        assignedBdaId: bdaObjectId,
      });
      return { leadType, count };
    })
  );
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
    totalAssignedLeads: totalAssigned + otherAssignedCounts.reduce((s, x) => s + x.count, 0),
    iitAssignedLeads: totalAssigned,
    counsellorAssignedLeads: otherAssignedCounts.find((x) => x.leadType === 'counsellor')?.count || 0,
    oneOnOneAssignedLeads: otherAssignedCounts.find((x) => x.leadType === 'one_on_one')?.count || 0,
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

async function fetchAssignedLeadsForType(leadType, bdaId, { q = '', limit = 200, bdaLanguage = '' } = {}) {
  const config = getLeadTypeConfig(leadType);
  if (!config) return [];

  if (leadType === 'iit_counselling') {
    const filter = bdaLeadFilter(bdaId, bdaLanguage);
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped } },
      ];
    }
    const rows = await IitCounsellingSubmission.find(filter)
      .sort({ assignedAt: -1, updatedAt: -1 })
      .limit(limit)
      .lean();
    const submissionIds = rows.map((r) => r._id);
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
    return rows.map((sub) =>
      config.mapToDto(sub, visitsBySubmissionId.get(String(sub._id)))
    );
  }

  const filter = {
    ...config.ownershipFilter,
    assignedBdaId: new mongoose.Types.ObjectId(bdaId),
  };
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (leadType === 'counsellor') {
      filter.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped } },
      ];
    } else if (leadType === 'one_on_one') {
      filter.$or = [
        { studentName: { $regex: escaped, $options: 'i' } },
        { mobileNumber: { $regex: escaped } },
      ];
    }
  }
  const rows = await config.model.find(filter).sort({ assignedAt: -1, updatedAt: -1 }).limit(limit).lean();
  return rows.map((row) => config.mapToDto(row));
}

async function listBdaLeads(bdaId, query = {}, bdaLanguage = '') {
  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(10, parseInt(query.limit, 10) || 25));
  const skip = (pageNum - 1) * limitNum;
  const leadTypeFilter = typeof query.leadType === 'string' ? query.leadType.trim() : 'all';
  const q = typeof query.q === 'string' ? query.q.trim() : '';

  if (leadTypeFilter !== 'all' && isValidLeadTypeFilter(leadTypeFilter)) {
    const type = normalizeBdaLeadType(leadTypeFilter);
    if (type === 'iit_counselling') {
      return listIitBdaLeads(bdaId, query, bdaLanguage, pageNum, limitNum);
    }
    const all = await fetchAssignedLeadsForType(type, bdaId, { q, limit: 1000, bdaLanguage });
    const total = all.length;
    const data = all.slice(skip, skip + limitNum);
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

  const merged = [];
  for (const type of BDA_LEAD_TYPES) {
    const batch = await fetchAssignedLeadsForType(type, bdaId, { q, limit: 500, bdaLanguage });
    merged.push(...batch);
  }
  merged.sort((a, b) => {
    const ta = new Date(a.assignedAt || a.updatedAt || 0).getTime();
    const tb = new Date(b.assignedAt || b.updatedAt || 0).getTime();
    return tb - ta;
  });
  const total = merged.length;
  const data = merged.slice(skip, skip + limitNum);
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

function isValidLeadTypeFilter(value) {
  return value === 'all' || BDA_LEAD_TYPES.includes(value);
}

async function listIitBdaLeads(bdaId, query, bdaLanguage, pageNum, limitNum) {
  const skip = (pageNum - 1) * limitNum;
  const filter = bdaLeadFilter(bdaId, bdaLanguage);

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

  const sortField = query.sort === 'updated' ? 'lastUpdatedAt' : 'assignedAt';
  const sortStage = { $sort: { [sortField]: -1, updatedAt: -1, createdAt: -1, _id: -1 } };

  const dedupePipeline = [
    { $match: filter },
    IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
    sortStage,
    { $group: { _id: '$phoneKey', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $project: { phoneKey: 0, _demoSortKey: 0 } },
    sortStage,
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
    data: data.map((row) => ({ ...row, leadType: 'iit_counselling', leadTypeLabel: REGISTRY.iit_counselling.label })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
}

async function getBdaLeadById(bdaId, leadId, bdaLanguage = '', leadTypeRaw = 'iit_counselling') {
  if (!mongoose.Types.ObjectId.isValid(leadId)) return null;
  const leadType = normalizeBdaLeadType(leadTypeRaw);
  const config = getLeadTypeConfig(leadType);
  if (!config) return null;

  if (leadType === 'iit_counselling') {
    const lead = await IitCounsellingSubmission.findOne({
      _id: leadId,
      ...bdaLeadFilter(bdaId, bdaLanguage),
    }).lean();
    if (!lead) return null;
    const visit = await IitCounsellingVisit.findOne({ submissionId: lead._id }).sort({ visitedAt: -1 }).lean();
    return config.mapToDto(lead, visit);
  }

  const lead = await config.model.findOne({
    _id: leadId,
    ...config.ownershipFilter,
    assignedBdaId: bdaId,
  }).lean();
  if (!lead) return null;
  return config.mapToDto(lead);
}

async function getLeadCallHistory(bdaId, leadId, leadTypeRaw = 'iit_counselling') {
  const leadType = normalizeBdaLeadType(leadTypeRaw);
  const owned = await findOwnedLeadForBda(leadType, leadId, bdaId);
  if (!owned) return null;

  const rows = await LeadCallHistory.find({ leadId, leadType })
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
