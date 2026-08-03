'use strict';

const express = require('express');
const router = express.Router();
const {
  getLeadDetailsByPhone,
  listLeadInsights,
  getLeadInsightsStats,
  getLeadActivityCalendar,
  getHotLeadInsights,
  getLeadTranscriptByPhone,
} = require('../controllers/leadInsightsController');

router.get('/stats', getLeadInsightsStats);
router.get('/activity', getLeadActivityCalendar);
router.get('/hot', getHotLeadInsights);
router.get('/', listLeadInsights);
router.get('/:phone/transcript', getLeadTranscriptByPhone);
router.get('/:phone', getLeadDetailsByPhone);

module.exports = router;
