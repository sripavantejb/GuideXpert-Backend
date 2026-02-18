const express = require('express');
const router = express.Router();
const { submitTrainingFeedback } = require('../controllers/feedbackController');

router.post('/', submitTrainingFeedback);

module.exports = router;
