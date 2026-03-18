const express = require('express');
const router = express.Router();
const { submitAssessment3, checkAssessment3Eligibility, checkActivationEligibility } = require('../controllers/assessmentController');

router.post('/submit', submitAssessment3);
router.get('/check', checkAssessment3Eligibility);
router.get('/check-activation', checkActivationEligibility);

module.exports = router;
