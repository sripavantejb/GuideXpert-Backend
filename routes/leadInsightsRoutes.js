'use strict';

const express = require('express');
const router = express.Router();
const {
  getLeadDetailsByPhone,
  listLeadInsights,
  getLeadInsightsStats,
  getHotLeadInsights,
} = require('../controllers/leadInsightsController');

router.get('/stats', getLeadInsightsStats);
router.get('/hot', getHotLeadInsights);
router.get('/', listLeadInsights);
router.get('/:phone', getLeadDetailsByPhone);

module.exports = router;
