const express = require('express');
const router = express.Router();
const {
  submitWebinarAssessment,
  getWebinarAssessmentHistory,
} = require('../controllers/webinarAssessmentController');

router.post('/submit', submitWebinarAssessment);
router.get('/history', getWebinarAssessmentHistory);

module.exports = router;
