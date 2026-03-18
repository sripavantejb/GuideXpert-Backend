const express = require('express');
const router = express.Router();
const { submitAssessment3, checkAssessment3Eligibility } = require('../controllers/assessmentController');

router.post('/submit', submitAssessment3);
router.get('/check', checkAssessment3Eligibility);

module.exports = router;
