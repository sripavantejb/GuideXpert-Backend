'use strict';

const {
  getLatestReport,
  getReportHistory,
  getReportByDate,
  generateDailyReport,
} = require('../services/analytics/executiveReportService');

exports.getLatestReport = async (req, res) => {
  try {
    const data = await getLatestReport();
    if (!data) {
      return res.status(404).json({ success: false, message: 'No executive reports found.' });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getLatestReport]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getReportHistory = async (req, res) => {
  try {
    const data = await getReportHistory(req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getReportHistory]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.postGenerateReport = async (req, res) => {
  try {
    const reportDate = req.body?.reportDate || req.query?.reportDate;
    const force = req.body?.force === true || req.query?.force === 'true';
    const data = await generateDailyReport({ reportDate, force });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[postGenerateReport]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getReportByDate = async (req, res) => {
  try {
    const data = await getReportByDate(req.params.date);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Report not found for that date.' });
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getReportByDate]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.generateDailyReportCron = async (req, res) => {
  try {
    const reportDate = req.query?.reportDate;
    const force = req.query?.force === 'true';
    const data = await generateDailyReport({ reportDate, force, deliveryStatus: 'generated' });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[generateDailyReportCron]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
