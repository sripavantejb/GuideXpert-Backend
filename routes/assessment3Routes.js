const express = require('express');
const router = express.Router();
const { submitAssessment3 } = require('../controllers/assessmentController');

router.post('/submit', submitAssessment3);

module.exports = router;
