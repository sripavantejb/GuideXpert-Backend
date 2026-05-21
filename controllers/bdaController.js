const mongoose = require('mongoose');
const Bda = require('../models/Bda');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitCounsellingVisit = require('../models/IitCounsellingVisit');
const {
  getAllBdaStats,
  getBdaStatsById,
  getLeaderboard,
  getTeamDashboardStats,
} = require('../services/bdaStatsService');
const {
  mapIitCounsellingLeadToDTO,
  IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
} = require('../utils/iitCounsellingLeadDto');

function mapBdaRow(bda) {
  return {
    id: bda._id,
    name: bda.name,
    phone: bda.phone || '',
    email: bda.email || '',
    status: bda.status,
    joinedAt: bda.joinedAt || bda.createdAt,
    createdAt: bda.createdAt,
    updatedAt: bda.updatedAt,
  };
}

exports.listBdas = async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filter = {};
    if (status === 'active' || status === 'inactive') filter.status = status;
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
    }
    const rows = await Bda.find(filter).sort({ name: 1 }).lean();
    return res.status(200).json({
      success: true,
      data: rows.map(mapBdaRow),
    });
  } catch (error) {
    console.error('[listBdas]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.createBda = async (req, res) => {
  try {
    const { name, phone, email, status, joinedAt } = req.body || {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (trimmedName.length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    const phoneRaw = typeof phone === 'string' ? phone.replace(/\D/g, '').slice(-10) : '';
    let phoneVal = '';
    if (phoneRaw) {
      if (!/^\d{10}$/.test(phoneRaw)) {
        return res.status(400).json({
          success: false,
          message: 'Phone must be exactly 10 digits, or leave blank',
        });
      }
      phoneVal = phoneRaw;
    }
    const doc = await Bda.create({
      name: trimmedName,
      phone: phoneVal || undefined,
      email: typeof email === 'string' ? email.trim().toLowerCase() : '',
      status: status === 'inactive' ? 'inactive' : 'active',
      joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
      createdBy: req.admin?._id || null,
    });
    return res.status(201).json({ success: true, data: mapBdaRow(doc.toObject()) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ success: false, message: 'Phone already in use' });
    }
    console.error('[createBda]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateBda = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }
    const { name, phone, email, status, joinedAt } = req.body || {};
    const $set = {};
    if (name !== undefined) {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (trimmedName.length < 2) {
        return res.status(400).json({ success: false, message: 'Invalid name' });
      }
      $set.name = trimmedName;
    }
    if (phone !== undefined) {
      if (!phone) {
        $set.phone = undefined;
      } else {
        const phoneVal = String(phone).replace(/\D/g, '').slice(-10);
        if (!/^\d{10}$/.test(phoneVal)) {
          return res.status(400).json({ success: false, message: 'Phone must be 10 digits' });
        }
        $set.phone = phoneVal;
      }
    }
    if (email !== undefined) $set.email = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (status === 'active' || status === 'inactive') $set.status = status;
    if (joinedAt !== undefined) {
      const d = new Date(joinedAt);
      if (!Number.isNaN(d.getTime())) $set.joinedAt = d;
    }

    const updated = await Bda.findByIdAndUpdate(id, { $set }, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }

    if ($set.name) {
      await IitCounsellingSubmission.updateMany(
        { assignedBdaId: updated._id },
        { $set: { assignedBdaName: updated.name } }
      );
    }

    return res.status(200).json({ success: true, data: mapBdaRow(updated) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ success: false, message: 'Phone already in use' });
    }
    console.error('[updateBda]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getTeamDashboard = async (req, res) => {
  try {
    const stats = await getTeamDashboardStats(req.query);
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('[getTeamDashboard]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getBdaStats = async (req, res) => {
  try {
    const { rows, dateRange } = await getAllBdaStats(req.query);
    return res.status(200).json({ success: true, data: { dateRange, rows } });
  } catch (error) {
    console.error('[getBdaStats]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getBdaStatsById = async (req, res) => {
  try {
    const data = await getBdaStatsById(req.params.id, req.query);
    if (!data) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getBdaStatsById]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getBdaLeaderboard = async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const data = await getLeaderboard(req.query, limit);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getBdaLeaderboard]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getBdaAssignedLeads = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }
    const bda = await Bda.findById(id).lean();
    if (!bda) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const filter = {
      submissionType: 'iitCounselling',
      assignedBdaId: new mongoose.Types.ObjectId(id),
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
          data: [{ $skip: skip }, { $limit: limit }],
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

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('[getBdaAssignedLeads]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
