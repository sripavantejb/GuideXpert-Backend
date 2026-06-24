const { listLeadTypeOptions } = require('../services/bdaLeadTypeRegistry');
const { listAssignableLeads } = require('../services/bdaAssignableLeadsService');
const {
  assignLeadToBda,
  bulkAssignLeads,
  bulkReassignLeads,
} = require('../services/iitCounsellingLeadAssignmentService');
const { normalizeBdaLeadType } = require('../constants/bdaLeadTypes');
const { getLeadTypeConfig } = require('../services/bdaLeadTypeRegistry');

exports.getBdaLeadTypes = async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: listLeadTypeOptions() });
  } catch (error) {
    console.error('[getBdaLeadTypes]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.listAssignableLeads = async (req, res) => {
  try {
    const leadType = normalizeBdaLeadType(req.query.leadType, '');
    if (!leadType) {
      return res.status(400).json({ success: false, message: 'leadType query param is required' });
    }
    const out = await listAssignableLeads(leadType, req.query);
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    return res.status(200).json({
      success: true,
      data: out.data,
      leadType: out.leadType,
      pagination: out.pagination,
    });
  } catch (error) {
    console.error('[listAssignableLeads]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.assignBdaLead = async (req, res) => {
  try {
    const leadType = normalizeBdaLeadType(req.params.leadType);
    const { id } = req.params;
    const { bdaId, reason } = req.body || {};
    const out = await assignLeadToBda({
      leadType,
      leadId: id,
      bdaId,
      admin: req.admin,
      reason,
      isReassign: false,
    });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    const config = getLeadTypeConfig(leadType);
    return res.status(200).json({
      success: true,
      data: config.mapToDto(out.lead),
    });
  } catch (error) {
    console.error('[assignBdaLead]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.reassignBdaLead = async (req, res) => {
  try {
    const leadType = normalizeBdaLeadType(req.params.leadType);
    const { id } = req.params;
    const { bdaId, reason } = req.body || {};
    const out = await assignLeadToBda({
      leadType,
      leadId: id,
      bdaId,
      admin: req.admin,
      reason,
      isReassign: true,
    });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    const config = getLeadTypeConfig(leadType);
    return res.status(200).json({
      success: true,
      data: config.mapToDto(out.lead),
    });
  } catch (error) {
    console.error('[reassignBdaLead]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.bulkAssignBdaLeads = async (req, res) => {
  try {
    const { leadType: rawLeadType, leadIds, bdaId, reason } = req.body || {};
    const leadType = normalizeBdaLeadType(rawLeadType);
    if (!bdaId) {
      return res.status(400).json({ success: false, message: 'bdaId is required' });
    }
    const out = await bulkAssignLeads({
      leadType,
      leadIds,
      bdaId,
      admin: req.admin,
      reason,
    });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    return res.status(200).json({ success: true, data: out.results });
  } catch (error) {
    console.error('[bulkAssignBdaLeads]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.bulkReassignBdaLeads = async (req, res) => {
  try {
    const { leadType: rawLeadType, leadIds, bdaId, reason } = req.body || {};
    const leadType = normalizeBdaLeadType(rawLeadType);
    if (!bdaId) {
      return res.status(400).json({ success: false, message: 'bdaId is required' });
    }
    const out = await bulkReassignLeads({
      leadType,
      leadIds,
      bdaId,
      admin: req.admin,
      reason,
    });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    return res.status(200).json({ success: true, data: out.results });
  } catch (error) {
    console.error('[bulkReassignBdaLeads]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
