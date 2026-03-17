const express = require('express');
const router = express.Router();
const { submitAssessment4 } = require('../controllers/assessmentController');

router.post('/submit', submitAssessment4);

module.exports = router;
