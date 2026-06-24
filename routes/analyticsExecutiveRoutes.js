'use strict';

const express = require('express');
const router = express.Router();
const {
  getLifecycleFunnel,
  getExecutiveSummary,
  getLifecycleValidation,
  postLifecycleBackfill,
} = require('../controllers/analyticsLifecycleController');
const {
  getAlerts,
  postAcknowledgeAlert,
  postResolveAlert,
  getFollowupEffectiveness,
  getCounsellorPerformance,
} = require('../controllers/analyticsAlertsController');
const {
  getLatestReport,
  getReportHistory,
  postGenerateReport,
  getReportByDate,
} = require('../controllers/analyticsReportsController');

router.get('/lifecycle/funnel', getLifecycleFunnel);
router.get('/lifecycle/validation', getLifecycleValidation);
router.post('/lifecycle/backfill', postLifecycleBackfill);
router.get('/executive/summary', getExecutiveSummary);

router.get('/alerts', getAlerts);
router.post('/alerts/:id/acknowledge', postAcknowledgeAlert);
router.post('/alerts/:id/resolve', postResolveAlert);
router.get('/followup-effectiveness', getFollowupEffectiveness);
router.get('/counsellor-performance', getCounsellorPerformance);

router.get('/reports/latest', getLatestReport);
router.get('/reports/history', getReportHistory);
router.get('/reports/:date', getReportByDate);
router.post('/reports/generate', postGenerateReport);

module.exports = router;
