const mongoose = require('mongoose');
const Bda = require('../models/Bda');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitCounsellingVisit = require('../models/IitCounsellingVisit');
const LeadCallHistory = require('../models/LeadCallHistory');
const IitCounsellingLeadActivity = require('../models/IitCounsellingLeadActivity');
const {
  getAllBdaStats,
  getBdaStatsById,
  getLeaderboard,
  getTeamDashboardStats,
  computeBdaMetrics,
} = require('../services/bdaStatsService');
const { fetchAssignedLeadsForBda } = require('../services/bdaAssignedLeadsService');
const { transferAllLeadsFromBda } = require('../services/iitCounsellingLeadAssignmentService');
const { REGISTRY, clearAssignmentFields } = require('../services/bdaLeadTypeRegistry');
const { resolveStatsDateRange } = require('../utils/statsDateRange');
const { BDA_LANGUAGES } = require('../constants/bdaLanguage');

function mapBdaRow(bda, extra = {}) {
  const id = String(bda._id);
  return {
    id,
    bdaId: id,
    name: bda.name,
    phone: bda.phone || '',
    email: bda.email || '',
    role: bda.role || 'BDA',
    language: bda.language || '',
    status: bda.status,
    joinedAt: bda.joinedAt || bda.createdAt,
    createdAt: bda.createdAt,
    updatedAt: bda.updatedAt,
    ...extra,
  };
}

exports.listBdas = async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const language = typeof req.query.language === 'string' ? req.query.language.trim() : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filter = {};
    if (status === 'active' || status === 'inactive') filter.status = status;
    if (BDA_LANGUAGES.includes(language)) filter.language = language;
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
    }
    const rows = await Bda.find(filter).sort({ name: 1 }).lean();
    const counts = await IitCounsellingSubmission.aggregate([
      {
        $match: {
          submissionType: 'iitCounselling',
          assignedBdaId: { $in: rows.map((r) => r._id) },
        },
      },
      { $group: { _id: '$assignedBdaId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
    return res.status(200).json({
      success: true,
      data: rows.map((r) =>
        mapBdaRow(r, { assignedLeadsCount: countMap.get(String(r._id)) || 0 })
      ),
    });
  } catch (error) {
    console.error('[listBdas]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.createBda = async (req, res) => {
  try {
    const { name, phone, email, password, status, joinedAt, language } = req.body || {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (trimmedName.length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    const emailVal = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!emailVal || !emailVal.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    const languageVal = typeof language === 'string' ? language.trim() : '';
    if (!BDA_LANGUAGES.includes(languageVal)) {
      return res.status(400).json({ success: false, message: 'BDA language must be Hindi or Telugu' });
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
      email: emailVal,
      password,
      role: 'BDA',
      language: languageVal,
      status: status === 'inactive' ? 'inactive' : 'active',
      joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
      createdBy: req.admin?._id || null,
    });
    return res.status(201).json({ success: true, data: mapBdaRow(doc.toObject()) });
  } catch (error) {
    if (error?.code === 11000) {
      const key = error?.keyPattern?.email ? 'Email' : 'Phone';
      return res.status(400).json({ success: false, message: `${key} already in use` });
    }
    console.error('[createBda]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.patchBdaStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }
    if (status !== 'active' && status !== 'inactive') {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const updated = await Bda.findByIdAndUpdate(id, { $set: { status } }, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }
    return res.status(200).json({ success: true, data: mapBdaRow(updated) });
  } catch (error) {
    console.error('[patchBdaStatus]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.resetBdaPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password, newPassword } = req.body || {};
    const pwd = newPassword || password;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }
    if (!pwd || typeof pwd !== 'string' || pwd.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    const bda = await Bda.findById(id).select('+password');
    if (!bda) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }
    bda.password = pwd;
    await bda.save();
    return res.status(200).json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('[resetBdaPassword]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateBda = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }
    const { name, phone, email, status, joinedAt, language } = req.body || {};
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
    if (language !== undefined) {
      const languageVal = typeof language === 'string' ? language.trim() : '';
      if (!BDA_LANGUAGES.includes(languageVal)) {
        return res.status(400).json({ success: false, message: 'BDA language must be Hindi or Telugu' });
      }
      $set.language = languageVal;
    }
    if (joinedAt !== undefined) {
      const d = new Date(joinedAt);
      if (!Number.isNaN(d.getTime())) $set.joinedAt = d;
    }

    const updated = await Bda.findByIdAndUpdate(id, { $set }, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }

    if ($set.name) {
      const nameUpdate = { assignedBdaName: updated.name };
      await Promise.all(
        Object.values(REGISTRY).map((config) =>
          config.model.updateMany({ assignedBdaId: updated._id }, { $set: nameUpdate })
        )
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

exports.deleteBda = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }

    const bda = await Bda.findById(id).lean();
    if (!bda) {
      return res.status(404).json({ success: false, message: 'BDA not found' });
    }

    await Promise.all([
      ...Object.values(REGISTRY).map((config) =>
        config.model.updateMany({ assignedBdaId: bda._id }, { $set: clearAssignmentFields() })
      ),
      LeadCallHistory.deleteMany({ bdaId: bda._id }),
      IitCounsellingLeadActivity.deleteMany({ bdaId: bda._id }),
    ]);

    await Bda.deleteOne({ _id: bda._id });

    return res.status(200).json({
      success: true,
      message: 'BDA deleted successfully',
      data: mapBdaRow(bda),
    });
  } catch (error) {
    console.error('[deleteBda]', error);
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

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const leadType = typeof req.query.leadType === 'string' ? req.query.leadType.trim() : 'iit_counselling';
    const { data, pagination } = await fetchAssignedLeadsForBda(id, {
      q,
      page: req.query.page,
      limit: req.query.limit,
      leadType,
    });

    return res.status(200).json({ success: true, data, pagination });
  } catch (error) {
    console.error('[getBdaAssignedLeads]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/** All BDA admin profiles with their assigned lead CRM data (Calling Data section). */
exports.getBdaCallingData = async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const leadsLimit = Math.min(200, Math.max(1, parseInt(req.query.leadsLimit, 10) || 100));
    const bdaIdFilter = typeof req.query.bdaId === 'string' ? req.query.bdaId.trim() : '';

    const bdaFilter = {};
    if (status === 'active' || status === 'inactive') bdaFilter.status = status;
    if (bdaIdFilter && mongoose.Types.ObjectId.isValid(bdaIdFilter)) {
      bdaFilter._id = new mongoose.Types.ObjectId(bdaIdFilter);
    }
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      bdaFilter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped } },
        { email: { $regex: escaped, $options: 'i' } },
      ];
    }

    const dateRange = resolveStatsDateRange(req.query);
    const bdas = await Bda.find(bdaFilter).sort({ name: 1 }).lean();

    const profiles = await Promise.all(
      bdas.map(async (bda) => {
        const [metrics, leadsOut] = await Promise.all([
          computeBdaMetrics(bda, dateRange),
          fetchAssignedLeadsForBda(bda._id, { page: 1, limit: leadsLimit }),
        ]);
        return {
          profile: mapBdaRow(bda),
          metrics,
          assignedLeads: leadsOut.data,
          leadsPagination: leadsOut.pagination,
        };
      })
    );

    const unassignedLeads = await IitCounsellingSubmission.countDocuments({
      submissionType: 'iitCounselling',
      $or: [{ assignedBdaId: null }, { assignedBdaId: { $exists: false } }],
    });

    return res.status(200).json({
      success: true,
      data: {
        dateRange,
        unassignedLeads,
        totalProfiles: profiles.length,
        profiles,
      },
    });
  } catch (error) {
    console.error('[getBdaCallingData]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.transferBdaLeads = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetBdaId, reason } = req.body || {};
    if (!targetBdaId) {
      return res.status(400).json({ success: false, message: 'targetBdaId is required' });
    }
    const out = await transferAllLeadsFromBda({
      sourceBdaId: id,
      targetBdaId,
      admin: req.admin,
      reason,
    });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    return res.status(200).json({
      success: true,
      data: {
        ...out.results,
        sourceBdaName: out.sourceBdaName,
        targetBdaName: out.targetBdaName,
      },
    });
  } catch (error) {
    console.error('[transferBdaLeads]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
