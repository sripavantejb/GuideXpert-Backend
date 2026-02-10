const express = require('express');
const router = express.Router();
const { submitAssessment2 } = require('../controllers/assessmentController');

router.post('/submit', submitAssessment2);

module.exports = router;
