const express = require('express');
const router = express.Router();
const { checkPosterEligibility } = require('../controllers/posterController');

router.post('/poster-eligibility', checkPosterEligibility);

module.exports = router;
