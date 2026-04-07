const express = require('express');
const router = express.Router();
const { checkPosterEligibility, trackPosterDownload } = require('../controllers/posterController');

router.post('/poster-eligibility', checkPosterEligibility);
router.post('/poster-downloads/track', trackPosterDownload);

module.exports = router;
