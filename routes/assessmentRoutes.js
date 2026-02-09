const express = require('express');
const router = express.Router();
const { submitAssessment } = require('../controllers/assessmentController');

router.post('/submit', submitAssessment);

module.exports = router;
