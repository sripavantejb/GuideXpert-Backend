const express = require('express');
const router = express.Router();
const {
  getPosterByRoute,
  verifyPosterActivation,
  getMarketingFeaturedPoster,
} = require('../controllers/posterTemplateController');

router.get('/by-route', getPosterByRoute);
router.get('/marketing-featured', getMarketingFeaturedPoster);
router.post('/verify-activation', verifyPosterActivation);

module.exports = router;
