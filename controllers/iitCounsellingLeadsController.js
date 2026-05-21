const mongoose = require('mongoose');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitCounsellingVisit = require('../models/IitCounsellingVisit');
const IitCounsellingLeadAssignmentHistory = require('../models/IitCounsellingLeadAssignmentHistory');
const IitCounsellingLeadActivity = require('../models/IitCounsellingLeadActivity');
const LeadCallHistory = require('../models/LeadCallHistory');
const {
  CALL_STATUS,
  LEAD_STATUS,
  DEMO_STATUS,
  NIAT_STATUS,
  PAYMENT_STATUS,
} = require('../constants/iitCounsellingLeadCrm');
const {
  mapIitCounsellingLeadToDTO,
  IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
} = require('../utils/iitCounsellingLeadDto');
const {
  assignLeadToBda,
  bulkAssignLeads,
  logActivity,
  getAdminActorName,
} = require('../services/iitCounsellingLeadAssignmentService');
const { formatActivityRow } = require('../services/bdaStatsService');
const {
  getAutoAssignPreview,
  autoAssignUnassignedByLanguage,
  autoAssignAllLanguages,
} = require('../services/bdaLanguageAssignmentService');
const { BDA_LANGUAGES } = require('../constants/bdaLanguage');
const {
  parseBdaLeadFilterQuery,
  buildLeadMatchWithMeet,
  aggregateDedupedLeads,
  getMeetFlagsForPhones,
  enrichDtoWithMeetFlags,
} = require('../services/bdaLeadFilterService');

async function attachVisits(rows) {
  const submissionIds = rows.map((r) => r._id).filter(Boolean);
  const visitsBySubmissionId = new Map();
  if (submissionIds.length > 0) {
    const visits = await IitCounsellingVisit.find({ submissionId: { $in: submissionIds } })
      .select('submissionId utm_source utm_medium utm_campaign utm_content')
      .sort({ visitedAt: -1 })
      .lean();
    for (const v of visits) {
      const key = String(v.submissionId);
      if (!visitsBySubmissionId.has(key)) visitsBySubmissionId.set(key, v);
    }
  }
  return rows.map((sub) =>
    mapIitCounsellingLeadToDTO(sub, visitsBySubmissionId.get(String(sub._id)))
  );
}

exports.listIitCounsellingLeads = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const assignedBdaId = typeof req.query.assignedBdaId === 'string' ? req.query.assignedBdaId.trim() : '';
    const unassignedOnly = req.query.unassignedOnly === 'true' || req.query.unassignedOnly === '1';
    const filtersApplied = req.query.filtersApplied === 'true' || req.query.filtersApplied === '1';

    const parsed = parseBdaLeadFilterQuery(req.query);
    let match;

    if (unassignedOnly && !filtersApplied) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 1 },
        filtersApplied: false,
      });
    }

    if (unassignedOnly) {
      const built = await buildLeadMatchWithMeet(parsed, { unassignedOnly: true });
      match = built.match;
    } else {
      const filter = { submissionType: 'iitCounselling' };
      if (assignedBdaId && mongoose.Types.ObjectId.isValid(assignedBdaId)) {
        filter.assignedBdaId = new mongoose.Types.ObjectId(assignedBdaId);
      }
      if (BDA_LANGUAGES.includes(parsed.preferredLanguage)) {
        filter['iitCounselling.section2Data.preferredLanguage'] = parsed.preferredLanguage;
      }
      const funnelFields = ['callStatus', 'leadStatus', 'demoStatus', 'niatStatus', 'paymentStatus'];
      for (const field of funnelFields) {
        const val = req.query[field];
        if (typeof val === 'string' && val.trim()) filter[field] = val.trim();
      }
      if (parsed.q) {
        const escaped = parsed.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [
            { fullName: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped } },
          ],
        });
      }
      match = filter;
    }

    const { rows, total } = await aggregateDedupedLeads({ match, page, limit });
    const dtos = await attachVisits(rows);
    const meetFlags = await getMeetFlagsForPhones(dtos.map((d) => d.phone));
    const data = dtos.map((d) => enrichDtoWithMeetFlags(d, meetFlags));

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      filtersApplied: unassignedOnly ? filtersApplied : true,
    });
  } catch (error) {
    console.error('[listIitCounsellingLeads]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getIitCounsellingLeadById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const sub = await IitCounsellingSubmission.findOne({
      _id: id,
      submissionType: 'iitCounselling',
    }).lean();
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const visit = await IitCounsellingVisit.findOne({ submissionId: sub._id })
      .sort({ visitedAt: -1 })
      .lean();
    const [activities, callHistory] = await Promise.all([
      IitCounsellingLeadActivity.find({ leadId: sub._id }).sort({ createdAt: -1 }).limit(30).lean(),
      LeadCallHistory.find({ leadId: sub._id }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        ...mapIitCounsellingLeadToDTO(sub, visit),
        recentActivities: activities.map(formatActivityRow),
        callHistory: callHistory.map((h) => ({
          id: String(h._id),
          bdaName: h.bdaName || h.actorName || '',
          callStatus: h.callStatus,
          leadStatus: h.leadStatus,
          demoStatus: h.demoStatus,
          niatRegistrationStatus: h.niatRegistrationStatus,
          paymentStatus: h.paymentStatus,
          callbackNeeded: h.callbackNeeded,
          callbackDateTime: h.callbackDateTime,
          callbackNote: h.callbackNote,
          remark: h.remark,
          createdAt: h.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('[getIitCounsellingLeadById]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.patchIitCounsellingLeadCrm = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const lead = await IitCounsellingSubmission.findOne({
      _id: id,
      submissionType: 'iitCounselling',
    });
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const body = req.body || {};
    const now = new Date();
    const updates = [];
    const bdaId = lead.assignedBdaId;
    const bdaName = lead.assignedBdaName || '';

    const applyField = (field, allowed, eventType) => {
      if (body[field] === undefined) return;
      const next = typeof body[field] === 'string' ? body[field].trim() : body[field];
      if (next === '' || next === null) {
        if (field === 'leadStatus') {
          lead.leadStatus = undefined;
        }
        return;
      }
      if (!allowed.includes(next)) {
        throw new Error(`Invalid ${field}`);
      }
      const prev = lead[field] || '';
      if (prev !== next) {
        lead[field] = next;
        updates.push({ eventType, fromValue: prev, toValue: next });
      }
    };

    try {
      applyField('callStatus', CALL_STATUS, 'call_status');
      applyField('leadStatus', LEAD_STATUS, 'lead_status');
      applyField('demoStatus', DEMO_STATUS, 'demo_status');
      applyField('niatStatus', NIAT_STATUS, 'niat_status');
      applyField('paymentStatus', PAYMENT_STATUS, 'payment_status');
    } catch (validationErr) {
      return res.status(400).json({ success: false, message: validationErr.message });
    }

    if (body.callbackDate !== undefined) {
      const raw = body.callbackDate;
      const prev = lead.callbackDate ? lead.callbackDate.toISOString() : '';
      if (!raw) {
        lead.callbackDate = null;
        updates.push({ eventType: 'callback_date', fromValue: prev, toValue: '' });
      } else {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid callbackDate' });
        }
        lead.callbackDate = d;
        updates.push({
          eventType: 'callback_date',
          fromValue: prev,
          toValue: d.toISOString(),
        });
      }
    }

    if (body.lastRemark !== undefined) {
      const remark = typeof body.lastRemark === 'string' ? body.lastRemark.trim().slice(0, 2000) : '';
      if (remark !== (lead.lastRemark || '')) {
        lead.lastRemark = remark;
        updates.push({ eventType: 'remark', fromValue: '', toValue: '', remark });
      }
    }

    if (updates.length === 0) {
      return res.status(200).json({
        success: true,
        data: mapIitCounsellingLeadToDTO(lead.toObject()),
      });
    }

    lead.crmUpdatedAt = now;
    lead.lastActivityAt = now;
    await lead.save();

    for (const u of updates) {
      await logActivity({
        leadId: lead._id,
        bdaId,
        bdaName,
        admin: req.admin,
        eventType: u.eventType,
        fromValue: u.fromValue,
        toValue: u.toValue,
        remark: u.remark || '',
      });
    }

    const visit = await IitCounsellingVisit.findOne({ submissionId: lead._id }).sort({ visitedAt: -1 }).lean();
    return res.status(200).json({
      success: true,
      data: mapIitCounsellingLeadToDTO(lead.toObject(), visit),
    });
  } catch (error) {
    console.error('[patchIitCounsellingLeadCrm]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.assignBda = async (req, res) => {
  try {
    const { id } = req.params;
    const { bdaId, reason } = req.body || {};
    const out = await assignLeadToBda({
      leadId: id,
      bdaId,
      admin: req.admin,
      reason,
      isReassign: false,
    });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    const visit = await IitCounsellingVisit.findOne({ submissionId: out.lead._id }).sort({ visitedAt: -1 }).lean();
    return res.status(200).json({
      success: true,
      data: mapIitCounsellingLeadToDTO(out.lead.toObject(), visit),
    });
  } catch (error) {
    console.error('[assignBda]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.reassignBda = async (req, res) => {
  try {
    const { id } = req.params;
    const { bdaId, reason } = req.body || {};
    const out = await assignLeadToBda({
      leadId: id,
      bdaId,
      admin: req.admin,
      reason,
      isReassign: true,
    });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    const visit = await IitCounsellingVisit.findOne({ submissionId: out.lead._id }).sort({ visitedAt: -1 }).lean();
    return res.status(200).json({
      success: true,
      data: mapIitCounsellingLeadToDTO(out.lead.toObject(), visit),
    });
  } catch (error) {
    console.error('[reassignBda]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.bulkAssignBda = async (req, res) => {
  try {
    const { leadIds, bdaId, reason } = req.body || {};
    const out = await bulkAssignLeads({ leadIds, bdaId, admin: req.admin, reason });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    return res.status(200).json({ success: true, data: out.results });
  } catch (error) {
    console.error('[bulkAssignBda]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getAutoAssignPreview = async (req, res) => {
  try {
    const preview = await getAutoAssignPreview(req.query);
    return res.status(200).json({ success: true, data: preview });
  } catch (error) {
    console.error('[getAutoAssignPreview]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.autoAssignLeadsByLanguage = async (req, res) => {
  try {
    const filtersApplied =
      req.query.filtersApplied === 'true' || req.query.filtersApplied === '1';
    if (!filtersApplied) {
      return res.status(400).json({
        success: false,
        message: 'Apply lead filters on BDA Management before auto-assigning.',
      });
    }

    const { language, reason } = req.body || {};
    const lang = typeof language === 'string' ? language.trim() : '';

    if (lang === 'all') {
      const results = await autoAssignAllLanguages({ admin: req.admin, reason, filterQuery: req.query });
      const hasError = Object.values(results).some((r) => r?.error);
      if (hasError) {
        return res.status(400).json({ success: false, message: 'One or more languages failed', data: results });
      }
      return res.status(200).json({ success: true, data: results });
    }

    const out = await autoAssignUnassignedByLanguage({
      language: lang,
      admin: req.admin,
      reason,
      filterQuery: req.query,
    });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    return res.status(200).json({ success: true, data: out });
  } catch (error) {
    console.error('[autoAssignLeadsByLanguage]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getAssignmentHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const rows = await IitCounsellingLeadAssignmentHistory.find({ leadId: id })
      .sort({ assignedAt: -1 })
      .populate('previousBdaId', 'name')
      .populate('newBdaId', 'name')
      .lean();

    return res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id,
        leadId: r.leadId,
        previousBdaId: r.previousBdaId?._id || r.previousBdaId || null,
        previousBdaName: r.previousBdaName || r.previousBdaId?.name || '',
        newBdaId: r.newBdaId?._id || r.newBdaId,
        newBdaName: r.newBdaName || r.newBdaId?.name || '',
        assignedBy: r.assignedBy,
        assignedAt: r.assignedAt,
        reason: r.reason || '',
      })),
    });
  } catch (error) {
    console.error('[getAssignmentHistory]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
