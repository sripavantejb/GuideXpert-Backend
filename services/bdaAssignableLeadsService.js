const mongoose = require('mongoose');
const { normalizeBdaLeadType } = require('../constants/bdaLeadTypes');
const { getLeadTypeConfig } = require('./bdaLeadTypeRegistry');

async function listAssignableLeads(leadTypeRaw, query = {}) {
  const leadType = normalizeBdaLeadType(leadTypeRaw);
  const config = getLeadTypeConfig(leadType);
  if (!config) {
    return { error: 'Invalid lead type', status: 400 };
  }

  if (leadType === 'iit_counselling') {
    return { error: 'Use /iit-counselling-leads for IIT counselling leads', status: 400 };
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 25));
  const skip = (page - 1) * limit;
  const unassignedOnly = query.unassignedOnly === 'true' || query.unassignedOnly === '1';
  const assignedBdaId = typeof query.assignedBdaId === 'string' ? query.assignedBdaId.trim() : '';
  const q = typeof query.q === 'string' ? query.q.trim() : '';

  const filter = { ...config.ownershipFilter };

  if (unassignedOnly) {
    filter.$or = [{ assignedBdaId: null }, { assignedBdaId: { $exists: false } }];
  } else if (assignedBdaId && mongoose.Types.ObjectId.isValid(assignedBdaId)) {
    filter.assignedBdaId = new mongoose.Types.ObjectId(assignedBdaId);
  }

  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (leadType === 'counsellor') {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { fullName: { $regex: escaped, $options: 'i' } },
          { phone: { $regex: escaped } },
        ],
      });
    } else if (leadType === 'one_on_one') {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { studentName: { $regex: escaped, $options: 'i' } },
          { mobileNumber: { $regex: escaped } },
        ],
      });
    }
  }

  if (leadType === 'one_on_one' && query.formCompleted === 'true') {
    filter.formCompleted = true;
  }

  const [rows, total] = await Promise.all([
    config.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    config.model.countDocuments(filter),
  ]);

  return {
    leadType,
    data: rows.map((row) => config.mapToDto(row)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

module.exports = { listAssignableLeads };
