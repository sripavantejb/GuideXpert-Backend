const express = require('express');
const router = express.Router();
const { submitTrainingFormResponse } = require('../controllers/trainingFormController');

router.post('/', submitTrainingFormResponse);

module.exports = router;
