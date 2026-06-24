const mongoose = require('mongoose');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitCounsellingVisit = require('../models/IitCounsellingVisit');
const { getLeadTypeConfig } = require('./bdaLeadTypeRegistry');
const { normalizeBdaLeadType } = require('../constants/bdaLeadTypes');
const {
  mapIitCounsellingLeadToDTO,
  IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
} = require('../utils/iitCounsellingLeadDto');

async function fetchAssignedLeadsForBda(bdaId, { q = '', page = 1, limit = 50, leadType: rawLeadType = 'iit_counselling' } = {}) {
  const leadType = normalizeBdaLeadType(rawLeadType);
  const config = getLeadTypeConfig(leadType);
  if (!config) {
    return { data: [], pagination: { page: 1, limit, total: 0, totalPages: 1 } };
  }

  if (leadType !== 'iit_counselling') {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;
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
      } else {
        filter.$or = [
          { studentName: { $regex: escaped, $options: 'i' } },
          { mobileNumber: { $regex: escaped } },
        ];
      }
    }
    const [rows, total] = await Promise.all([
      config.model.find(filter).sort({ assignedAt: -1, updatedAt: -1 }).skip(skip).limit(limitNum).lean(),
      config.model.countDocuments(filter),
    ]);
    return {
      data: rows.map((row) => config.mapToDto(row)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      },
    };
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const filter = {
    submissionType: 'iitCounselling',
    assignedBdaId: new mongoose.Types.ObjectId(bdaId),
  };
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { fullName: { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped } },
    ];
  }

  const dedupePipeline = [
    { $match: filter },
    IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
    { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$phoneKey', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $project: { phoneKey: 0, _demoSortKey: 0 } },
    { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
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

module.exports = { fetchAssignedLeadsForBda };
