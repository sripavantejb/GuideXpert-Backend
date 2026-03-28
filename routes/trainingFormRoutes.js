const express = require('express');
const router = express.Router();
const { submitTrainingFormResponse, getTrainingFormStatus } = require('../controllers/trainingFormController');

router.get('/check/:phone', getTrainingFormStatus);
router.post('/', submitTrainingFormResponse);

module.exports = router;
