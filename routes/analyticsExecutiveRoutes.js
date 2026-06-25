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
const { getDemandSummary } = require('../controllers/demandIntelligenceController');
const {
  getPredictionByPhone,
  getPredictionPortfolio,
  postRecomputePredictions,
} = require('../controllers/analyticsPredictionController');

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

router.get('/demand/summary', getDemandSummary);

router.get('/predictions/portfolio', getPredictionPortfolio);
router.post('/predictions/recompute', postRecomputePredictions);
router.get('/predictions/:phone', getPredictionByPhone);

module.exports = router;
