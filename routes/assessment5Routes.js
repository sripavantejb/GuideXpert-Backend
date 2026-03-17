const express = require('express');
const router = express.Router();
const { submitAssessment5 } = require('../controllers/assessmentController');

router.post('/submit', submitAssessment5);

module.exports = router;
