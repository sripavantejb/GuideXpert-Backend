const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const {
  getPosterByRoute,
  verifyPosterActivation,
  getMarketingFeaturedPoster,
} = require('../controllers/posterTemplateController');

attachRouteIndex(router, {
  name: 'posters',
  routes: [
    { method: 'GET', path: '/by-route', note: 'query: route' },
    { method: 'GET', path: '/marketing-featured' },
    { method: 'POST', path: '/verify-activation' },
  ],
});
router.get('/by-route', getPosterByRoute);
router.get('/marketing-featured', getMarketingFeaturedPoster);
router.post('/verify-activation', verifyPosterActivation);

module.exports = router;
