const mongoose = require('mongoose');
const {
  getBdaDashboardStats,
  listBdaLeads,
  getBdaLeadById,
  getLeadCallHistory,
} = require('../services/bdaPortalService');
const {
  listBdaNotifications,
  markBdaNotificationsRead,
} = require('../services/bdaNotificationService');
const { updateLeadByBda } = require('../services/bdaLeadUpdateService');

exports.getDashboardStats = async (req, res) => {
  try {
    const stats = await getBdaDashboardStats(req.bda.id, req.bda.language);
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('[bdaDashboardStats]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.listLeads = async (req, res) => {
  try {
    const { data, pagination } = await listBdaLeads(req.bda.id, req.query, req.bda.language);
    return res.status(200).json({ success: true, data, pagination });
  } catch (error) {
    console.error('[bdaListLeads]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getLead = async (req, res) => {
  try {
    const lead = await getBdaLeadById(req.bda.id, req.params.id, req.bda.language);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    return res.status(200).json({ success: true, data: lead });
  } catch (error) {
    console.error('[bdaGetLead]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateLead = async (req, res) => {
  try {
    const out = await updateLeadByBda({
      leadId: req.params.id,
      bda: req.bda,
      body: req.body || {},
    });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    return res.status(200).json({ success: true, data: out.lead });
  } catch (error) {
    console.error('[bdaUpdateLead]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getLeadHistory = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const history = await getLeadCallHistory(req.bda.id, req.params.id);
    if (history === null) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    return res.status(200).json({ success: true, data: history });
  } catch (error) {
    console.error('[bdaLeadHistory]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const out = await listBdaNotifications(req.bda.id, req.query);
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    return res.status(200).json({
      success: true,
      data: out.data,
      unreadCount: out.unreadCount,
      pagination: out.pagination,
    });
  } catch (error) {
    console.error('[bdaGetNotifications]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.markNotificationsRead = async (req, res) => {
  try {
    const { ids, all } = req.body || {};
    const out = await markBdaNotificationsRead(req.bda.id, { ids, all: all === true });
    if (out.error) {
      return res.status(out.status || 400).json({ success: false, message: out.error });
    }
    return res.status(200).json({ success: true, data: out });
  } catch (error) {
    console.error('[bdaMarkNotificationsRead]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
