'use strict';

const {
  listAlerts,
  acknowledgeAlert,
  resolveAlert,
  evaluateAllAlerts,
} = require('../services/analytics/smartAlertsService');
const { getFollowupEffectiveness } = require('../services/analytics/followupEffectivenessService');
const { getCounsellorPerformance } = require('../services/analytics/counsellorPerformanceService');

exports.getAlerts = async (req, res) => {
  try {
    const data = await listAlerts(req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getAlerts]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.postAcknowledgeAlert = async (req, res) => {
  try {
    const result = await acknowledgeAlert(req.params.id, req.admin?._id);
    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }
    return res.status(200).json({ success: true, data: result.alert });
  } catch (error) {
    console.error('[postAcknowledgeAlert]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.postResolveAlert = async (req, res) => {
  try {
    const result = await resolveAlert(req.params.id, req.admin?._id);
    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }
    return res.status(200).json({ success: true, data: result.alert });
  } catch (error) {
    console.error('[postResolveAlert]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getFollowupEffectiveness = async (req, res) => {
  try {
    const sinceDays = req.query?.sinceDays;
    const data = await getFollowupEffectiveness({ sinceDays });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getFollowupEffectiveness]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getCounsellorPerformance = async (req, res) => {
  try {
    const sinceDays = req.query?.sinceDays;
    const data = await getCounsellorPerformance({ sinceDays });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getCounsellorPerformance]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.evaluateAlertsCron = async (req, res) => {
  try {
    const stats = await evaluateAllAlerts();
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('[evaluateAlertsCron]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
